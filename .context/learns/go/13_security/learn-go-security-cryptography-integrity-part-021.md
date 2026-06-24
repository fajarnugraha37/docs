# learn-go-security-cryptography-integrity-part-021.md

> **Series**: `learn-go-security-cryptography-integrity`  
> **Part**: `021 / 034`  
> **Title**: Input Validation and Canonicalization in Go  
> **Subtitle**: URL, path, Unicode, email, MIME, multipart, archive traversal, normalization, parser ambiguity, and reject-by-default design  
> **Target Go Version**: Go 1.26.x  
> **Audience**: Java software engineer moving into top-tier Go security engineering  
> **Status**: Handbook-grade learning material

---

## 0. Why This Part Exists

Input validation looks deceptively simple.

Most engineers think it means:

```text
Check string length.
Check regex.
Return 400 if invalid.
```

That is not wrong, but it is incomplete.

In real production systems, input validation is not only about rejecting bad text. It is about ensuring that every untrusted value is transformed into **one explicit, canonical, typed, bounded, authorized interpretation** before it can affect business state, filesystem state, network state, cryptographic state, audit state, or identity state.

A weak input boundary lets attackers exploit ambiguity.

Examples:

```text
/path/%2e%2e/admin
/path/%252e%252e/admin
C:\uploads\..\Windows\system.ini
../../etc/passwd
％2e％2e/
résumé.pdf
resumé.pdf
image.jpg.php
file.pdf%00.exe
{"role":"user","role":"admin"}
{"amount":9007199254740993}
https://example.com@evil.test/
http://127.0.0.1:80/
http://[::ffff:127.0.0.1]/
```

The bug is rarely "the code did not check input at all."

The more common bug is:

```text
Layer A parsed the input one way.
Layer B normalized it differently.
Layer C authorized the pre-normalized value.
Layer D executed the post-normalized value.
```

That gap is where security bugs live.

---

## 1. Learning Objectives

After this part, you should be able to:

1. Design a Go input boundary that produces typed domain values, not raw strings.
2. Explain the difference between parsing, decoding, normalization, validation, authorization, and output encoding.
3. Identify canonicalization bugs in URL, filesystem path, Unicode, email, MIME, multipart, JSON, and archive handling.
4. Avoid common Go mistakes involving `net/url`, `path`, `path/filepath`, `os.Root`, `encoding/json`, `mime/multipart`, `archive/zip`, and `archive/tar`.
5. Build reject-by-default validation pipelines for API services.
6. Write Go wrappers that make unsafe states unrepresentable.
7. Model validation as a security invariant, not a UI convenience.
8. Review PRs for parser ambiguity, path traversal, upload bypass, archive traversal, duplicate JSON keys, Unicode confusion, and resource exhaustion.

---

## 2. The Core Mental Model

Security validation is not:

```text
"Does this string look okay?"
```

Security validation is:

```text
"Can this untrusted value be safely converted into a single domain meaning
under the rules of this boundary?"
```

The pipeline is:

```text
Raw bytes
  -> decode transport
  -> parse into syntax
  -> normalize/canonicalize
  -> validate shape and bounds
  -> bind to identity/tenant/context
  -> authorize
  -> convert to domain type
  -> execute
  -> encode for the output context
```

Mermaid:

```mermaid
flowchart TD
    A[Raw untrusted bytes] --> B[Transport decode]
    B --> C[Syntax parse]
    C --> D[Canonicalize / normalize]
    D --> E[Validate shape, type, bounds]
    E --> F[Bind to actor, tenant, resource]
    F --> G[Authorize]
    G --> H[Create trusted domain value]
    H --> I[Use in business logic]
    I --> J[Context-aware output encoding]

    C -. parser ambiguity .-> X[Reject]
    D -. non-canonical .-> X
    E -. invalid .-> X
    F -. mismatched context .-> X
    G -. unauthorized .-> X
```

Key distinction:

| Stage | Question | Example |
|---|---|---|
| Decode | What bytes did transport encode? | `%2F`, multipart boundary, JSON string escape |
| Parse | Is the syntax valid? | URL grammar, JSON grammar, email address grammar |
| Normalize | Are equivalent forms collapsed? | Unicode NFC, path cleanup, host lowercase |
| Canonicalize | Is there exactly one representation? | canonical URL path, canonical JSON signing input |
| Validate | Is the value allowed? | max length, allowed chars, allowed enum |
| Bind | What context does it belong to? | actor ID, tenant ID, case ID, module ID |
| Authorize | May this actor perform this action? | object-level permission |
| Encode | Is it safe in output context? | HTML, SQL parameter, shell arg, log field |

Do not collapse these into one "validate" function.

---

## 3. Java-to-Go Mindset Shift

Coming from Java, you may be used to frameworks that provide:

```text
Bean Validation
Servlet filters
Spring MVC binding
Jackson DTO mapping
Multipart abstractions
PathResourceResolver
Hibernate Validator
Security filter chain
```

In Go, there is less framework gravity. This is a strength and a risk.

Go makes it easy to write a precise boundary, but it also makes it easy to accidentally do everything inline in handlers:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    file := r.URL.Query().Get("file")
    // validate maybe later...
}
```

A strong Go service should instead create explicit domain input types:

```go
type CaseID string
type TenantID string
type SafeUploadName string
type CanonicalEmail string
type PublicRedirectURL struct {
    raw *url.URL
}
```

The security goal is:

```text
Raw input should not travel deep into the system.
Only validated domain values should.
```

This is the Go equivalent of a hardened boundary layer.

---

## 4. The Biggest Rule: Validate for the Consumer, Not the Producer

A value may be safe for one consumer and unsafe for another.

| Input | Safe for display? | Safe for file path? | Safe for URL path? | Safe for SQL? | Safe for shell? |
|---|---:|---:|---:|---:|---:|
| `O'Brien` | yes, encoded | maybe | maybe | yes if parameterized | no if shell-concatenated |
| `../x` | yes, encoded | no | maybe path segment if escaped | yes if parameterized | no |
| `<b>x</b>` | yes if escaped | maybe | maybe | yes if parameterized | no |
| `a/b` | yes | maybe forbidden as filename | path hierarchy | yes | no |
| `%2f` | yes | maybe | dangerous if decoded differently | yes | no |

Therefore, never build a universal validator like:

```go
func IsSafeString(s string) bool
```

That function is usually meaningless.

Prefer context-specific constructors:

```go
func ParseCaseID(s string) (CaseID, error)
func ParseTenantScopedCaseID(actor Actor, s string) (TenantScopedCaseID, error)
func ParseUploadFilename(s string) (SafeUploadName, error)
func ParsePublicRedirectURL(s string) (PublicRedirectURL, error)
func ParseCanonicalEmail(s string) (CanonicalEmail, error)
```

---

## 5. Input Boundary Taxonomy

A mature Go service has many input sources.

```mermaid
flowchart LR
    A[HTTP path params] --> Z[Input boundary]
    B[Query params] --> Z
    C[Headers] --> Z
    D[Cookies] --> Z
    E[JSON body] --> Z
    F[Multipart body] --> Z
    G[Uploaded files] --> Z
    H[Archive entries] --> Z
    I[Message queue payloads] --> Z
    J[Webhook payloads] --> Z
    K[Env vars] --> Z
    L[Config files] --> Z
    M[DB text fields] --> Z
    N[CLI args] --> Z
    O[Third-party API response] --> Z

    Z --> P[Typed trusted domain values]
```

Important lesson:

> Data retrieved from a database is not automatically trusted.

It may originally have come from a user, third-party integration, migration script, or compromised upstream service.

---

## 6. A Security Validation Contract

Every external boundary should define:

```text
1. Source
2. Encoding
3. Parser
4. Canonical form
5. Allowed shape
6. Length / size / count bounds
7. Ownership / tenant binding
8. Authorization rule
9. Error behavior
10. Audit behavior
11. Logging behavior
12. Test corpus
```

Example for `case_id`:

```text
Source:
  HTTP path parameter /cases/{case_id}

Encoding:
  URL path segment, not query value

Parser:
  path variable extraction after router decoding

Canonical form:
  uppercase ASCII "CASE-" + 12 digits

Allowed shape:
  ^CASE-[0-9]{12}$

Bounds:
  exactly 17 bytes

Ownership:
  case must belong to actor tenant or actor must have cross-tenant role

Authorization:
  actor must have case:view permission

Error:
  malformed -> 400
  valid but nonexistent -> 404
  valid but unauthorized -> 404 or 403 according to policy

Audit:
  authorized reads may be sampled
  unauthorized attempts logged as security event with hashed ID

Logging:
  log canonical case_id only if classified non-sensitive
```

---

## 7. Reject-by-Default Design

Reject-by-default means:

```text
If a value is not explicitly allowed by the boundary contract, reject it.
```

This is stronger than denylisting.

Bad:

```go
func IsBad(s string) bool {
    return strings.Contains(s, "..") ||
        strings.Contains(s, "<script>") ||
        strings.Contains(s, "' OR '1'='1")
}
```

Better:

```go
var caseIDPattern = regexp.MustCompile(`^CASE-[0-9]{12}$`)

func ParseCaseID(s string) (CaseID, error) {
    if !caseIDPattern.MatchString(s) {
        return "", errors.New("invalid case id")
    }
    return CaseID(s), nil
}
```

Why denylist fails:

```text
Attackers have infinite variants.
Defenders have finite imagination.
```

Allowlist works best when the domain is narrow.

Examples:

| Domain | Allowlist Style |
|---|---|
| Role | enum |
| Country code | ISO code table |
| Case ID | exact regex |
| Postal code | country-specific parser |
| Sort field | map of allowed DB columns |
| MIME type | exact allowlist |
| Upload extension | exact allowlist after canonicalization |
| Redirect target | registered allowlist |
| State transition | finite state machine |

---

## 8. Validation Is Not Output Encoding

Input validation does not replace output encoding.

Free-form text often legitimately contains characters that are dangerous in HTML, SQL, shell, logs, CSV, or Markdown.

Example:

```text
User name: O'Brien <Admin>
```

This may be valid as a display name.

It must still be encoded when rendered into HTML.

Wrong mental model:

```text
Reject all characters that might be dangerous somewhere.
```

Correct mental model:

```text
Validate according to domain rules.
Encode according to output context.
```

Mermaid:

```mermaid
flowchart LR
    A[Valid display name] --> B[HTML encoder]
    A --> C[JSON encoder]
    A --> D[SQL parameter]
    A --> E[Log structured field]
    A --> F[CSV cell sanitizer]

    B --> G[Safe for HTML]
    C --> H[Safe for JSON]
    D --> I[Safe for SQL]
    E --> J[Safe for logs]
    F --> K[Safe for spreadsheet]
```

---

## 9. Go Package Map for This Part

| Concern | Go Package |
|---|---|
| URL parsing | `net/url` |
| HTTP request parsing | `net/http` |
| File path manipulation | `path/filepath` |
| Slash-separated paths | `path` |
| Rooted filesystem access | `os.Root` |
| JSON parsing | `encoding/json` |
| Multipart parsing | `mime/multipart`, `net/http` |
| MIME sniffing | `net/http.DetectContentType` |
| Archive zip | `archive/zip` |
| Archive tar | `archive/tar` |
| UTF-8 validation | `unicode/utf8` |
| Unicode classes | `unicode` |
| Unicode normalization | `golang.org/x/text/unicode/norm` |
| IDNA domains | `golang.org/x/net/idna` |
| Email parsing | `net/mail` |
| Regex | `regexp` |
| Size limits | `io.LimitedReader`, `http.MaxBytesReader` |
| Time parsing | `time` |
| IP parsing | `net/netip` |

---

## 10. Secure Boundary Pattern in Go

Use a dedicated input package.

Example package layout:

```text
internal/
  boundary/
    caseid.go
    email.go
    url.go
    upload.go
    json.go
    errors.go
  httpapi/
    handlers.go
  domain/
    case.go
```

Example:

```go
package boundary

import (
	"errors"
	"regexp"
)

type CaseID string

var caseIDPattern = regexp.MustCompile(`^CASE-[0-9]{12}$`)

func ParseCaseID(raw string) (CaseID, error) {
	if !caseIDPattern.MatchString(raw) {
		return "", errors.New("invalid case id")
	}
	return CaseID(raw), nil
}

func (id CaseID) String() string {
	return string(id)
}
```

Handler:

```go
func (h *Handler) GetCase(w http.ResponseWriter, r *http.Request) {
	rawID := r.PathValue("case_id")

	caseID, err := boundary.ParseCaseID(rawID)
	if err != nil {
		h.writeBadRequest(w, "invalid case id")
		return
	}

	actor := ActorFromContext(r.Context())

	c, err := h.cases.GetVisibleCase(r.Context(), actor, caseID)
	if err != nil {
		h.writeDomainError(w, err)
		return
	}

	h.writeJSON(w, c)
}
```

The handler does not pass raw strings deeper.

---

## 11. Error Taxonomy for Validation

Avoid returning low-level parser details to clients.

| Condition | HTTP | Client Message | Security Logging |
|---|---:|---|---|
| Syntax malformed | 400 | `invalid request` | low |
| Unknown field | 400 | `unknown field: x` maybe safe | medium if repeated |
| Invalid enum | 400 | `invalid value` | low |
| Size limit exceeded | 413 | `request too large` | medium |
| Unsupported media type | 415 | `unsupported media type` | low |
| Valid but unauthorized | 403/404 | policy-dependent | high |
| Valid but nonexistent | 404 | `not found` | low |
| Suspicious traversal attempt | 400 | `invalid path` | medium/high |
| Archive bomb attempt | 413/422 | `invalid archive` | high |
| Parser panic | 500 | generic | critical |

---

## 12. URL Validation

URLs are complex because they contain multiple sublanguages:

```text
scheme://userinfo@host:port/path?query#fragment
```

Each part has different escaping rules.

### 12.1 Common URL Mistakes

Mistake:

```go
if strings.HasPrefix(raw, "https://trusted.example.com") {
    // safe?
}
```

Bypass examples:

```text
https://trusted.example.com.evil.test/
https://trusted.example.com@evil.test/
https://trusted.example.com%2eevil.test/
https://trusted.example.com:443@evil.test/
```

Mistake:

```go
target := "https://api.example.com/" + userPath
```

Bypass examples:

```text
../admin
%2e%2e/admin
//evil.test/path
?x=...
#fragment
```

Mistake:

```go
u, _ := url.Parse(raw)
if u.Host == "example.com" { ... }
```

`u.Host` can include a port. Use `u.Hostname()` and validate port separately.

### 12.2 Safe External URL Parser

For public redirect URLs:

```go
package boundary

import (
	"errors"
	"net/url"
	"strings"
)

type PublicRedirectURL struct {
	u *url.URL
}

var allowedRedirectHosts = map[string]struct{}{
	"app.example.com":     {},
	"support.example.com": {},
}

func ParsePublicRedirectURL(raw string) (PublicRedirectURL, error) {
	if len(raw) == 0 || len(raw) > 2048 {
		return PublicRedirectURL{}, errors.New("invalid redirect url")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return PublicRedirectURL{}, errors.New("invalid redirect url")
	}

	if u.Scheme != "https" {
		return PublicRedirectURL{}, errors.New("invalid redirect scheme")
	}

	if u.User != nil {
		return PublicRedirectURL{}, errors.New("userinfo not allowed")
	}

	host := strings.ToLower(u.Hostname())
	if _, ok := allowedRedirectHosts[host]; !ok {
		return PublicRedirectURL{}, errors.New("redirect host not allowed")
	}

	if p := u.Port(); p != "" && p != "443" {
		return PublicRedirectURL{}, errors.New("redirect port not allowed")
	}

	u.Fragment = "" // fragments are client-side only; do not preserve unless needed

	return PublicRedirectURL{u: u}, nil
}

func (p PublicRedirectURL) String() string {
	return p.u.String()
}
```

### 12.3 URL Path Segments

If you need to place a user value inside a URL path, treat it as a path segment, not raw path text.

Wrong:

```go
url := "https://api.example.com/users/" + userID
```

Better:

```go
u := &url.URL{
	Scheme: "https",
	Host:   "api.example.com",
	Path:   path.Join("users", userID), // only if userID cannot contain slash
}
```

If `userID` may contain slash-like characters, you need segment escaping semantics, not hierarchy joining.

```go
segment := url.PathEscape(userID)
target := "https://api.example.com/users/" + segment
```

Important:

```text
Path escaping and query escaping are different.
```

`url.PathEscape` is for path segments.

`url.QueryEscape` is for query values.

### 12.4 URL Canonicalization Policy

A secure URL policy should state:

```text
Allowed schemes:
  https only

Allowed host:
  exact allowlist after lowercase and IDNA conversion if international domains are supported

Allowed port:
  empty or 443

Userinfo:
  forbidden

Fragment:
  stripped unless business explicitly needs it

Path:
  canonicalized according to endpoint-specific rules

Query:
  parsed into url.Values, allowed keys only, length/count limits

Redirect:
  prefer server-side redirect IDs instead of arbitrary URLs
```

Better redirect design:

```text
GET /login?return_to=dashboard
```

Server mapping:

```go
var returnTo = map[string]string{
	"dashboard": "/dashboard",
	"profile":   "/profile",
}
```

This is better than accepting arbitrary URLs.

---

## 13. SSRF Is Not Only URL Validation

SSRF will be covered deeply in part 023, but URL validation starts here.

Never assume this is sufficient:

```go
u.Scheme == "http" || u.Scheme == "https"
```

You must also consider:

```text
localhost
127.0.0.1
::1
0.0.0.0
169.254.169.254
metadata.google.internal
private RFC1918 ranges
IPv6 private/link-local ranges
DNS rebinding
redirect following
proxy environment variables
userinfo confusion
encoded host confusion
IDNA confusion
```

A URL may be syntactically valid and still unsafe as an outbound network target.

---

## 14. Filesystem Path Validation

Filesystem path validation is one of the highest-risk areas because:

```text
The OS, platform, symlink behavior, mount points, archive formats, and path libraries
all interact.
```

### 14.1 `path` vs `path/filepath`

Use:

```text
path          -> slash-separated paths, URLs, archive names
path/filepath -> local OS filesystem paths
```

Do not use `filepath.Join` for URLs.

Do not use `path.Join` for Windows filesystem paths.

### 14.2 `filepath.Clean` Is Not a Security Boundary

`filepath.Clean` normalizes.

It does not authorize.

Wrong:

```go
name := filepath.Clean(r.URL.Query().Get("name"))
return os.Open(filepath.Join(uploadDir, name))
```

Why wrong?

```text
Clean may produce a normalized path that still escapes the intended directory.
Joining does not prove containment.
Symlink traversal can still escape.
Platform-specific path rules matter.
```

### 14.3 `filepath.IsLocal`

`filepath.IsLocal` helps answer whether a path is local according to Go's definition.

A local path is non-absolute, non-empty, does not contain `..`, and on Windows is not a reserved name such as `NUL`.

Example:

```go
func validateLocalRelativePath(p string) error {
	if !filepath.IsLocal(p) {
		return errors.New("path is not local")
	}
	return nil
}
```

But this does not solve every threat model.

If an attacker controls symlinks or the local filesystem under the directory, string validation is not enough.

### 14.4 `os.Root` for Traversal-Resistant Access

Go 1.24 added `os.Root`.

`os.Root` allows filesystem operations rooted under a directory tree. Methods on `Root` only access files beneath the root directory; if a path component references a location outside the root, the method returns an error. It also follows symbolic links only if they do not escape the root.

Use this when available.

Example:

```go
package storage

import (
	"errors"
	"io"
	"os"
	"path/filepath"
)

type UploadStore struct {
	root *os.Root
}

func OpenUploadStore(dir string) (*UploadStore, error) {
	r, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &UploadStore{root: r}, nil
}

func (s *UploadStore) Close() error {
	return s.root.Close()
}

func (s *UploadStore) OpenUserFile(name string) (*os.File, error) {
	if name == "" || len(name) > 255 {
		return nil, errors.New("invalid filename")
	}

	// Defense-in-depth. Root is the actual boundary.
	if !filepath.IsLocal(name) {
		return nil, errors.New("invalid filename")
	}

	return s.root.Open(name)
}

func (s *UploadStore) WriteUserFile(name string, src io.Reader) error {
	if name == "" || len(name) > 255 {
		return errors.New("invalid filename")
	}
	if !filepath.IsLocal(name) {
		return errors.New("invalid filename")
	}

	f, err := s.root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, src)
	return err
}
```

### 14.5 Generated Filenames Beat Sanitized Filenames

For uploads, do not store using the user-supplied filename.

Prefer:

```text
stored object ID:
  01JABC...ULID

metadata:
  original_name: sanitized for display only
  detected_mime: application/pdf
  size: 123456
  sha256: ...
```

Storage path:

```text
/uploads/tenant-123/01JABCDEF...
```

Display name is data, not path.

---

## 15. Unicode Validation

Unicode bugs happen because humans and machines disagree about "same."

Examples:

```text
é        U+00E9 LATIN SMALL LETTER E WITH ACUTE
é       U+0065 LATIN SMALL LETTER E + U+0301 COMBINING ACUTE ACCENT
Α        Greek capital alpha
A        Latin capital A
а        Cyrillic small a
a        Latin small a
```

They may look similar but compare differently.

### 15.1 Go Strings Are Bytes

A Go `string` is an immutable byte sequence.

It is often UTF-8 by convention, but the type itself can contain invalid UTF-8.

Therefore, if a field must be valid UTF-8, check it:

```go
import "unicode/utf8"

func requireUTF8(s string) error {
	if !utf8.ValidString(s) {
		return errors.New("invalid utf-8")
	}
	return nil
}
```

### 15.2 Length: Bytes, Runes, or Graphemes?

Different length rules mean different things.

| Measurement | Go Method | Meaning |
|---|---|---|
| Bytes | `len(s)` | storage/network size |
| Runes | `utf8.RuneCountInString(s)` or `for range` | Unicode code points |
| Grapheme clusters | external library needed | user-perceived characters |

For security limits, always set byte limits.

For user-facing text, you may also set rune or grapheme limits.

Example:

```go
func ValidateDisplayName(s string) error {
	if len(s) < 1 || len(s) > 128 {
		return errors.New("invalid display name length")
	}
	if !utf8.ValidString(s) {
		return errors.New("invalid utf-8")
	}
	return nil
}
```

### 15.3 Unicode Normalization

Use `golang.org/x/text/unicode/norm`.

Example:

```go
import "golang.org/x/text/unicode/norm"

func canonicalText(s string) string {
	return norm.NFC.String(s)
}
```

Policy:

```text
Identifiers:
  Prefer ASCII-only unless there is a strong product requirement.

Display names:
  Allow Unicode, normalize to NFC, reject invalid UTF-8, set byte/rune limits.

Search:
  Use separate search normalization pipeline.

Security-sensitive comparisons:
  Compare canonical forms, not raw user input.

Audit:
  Store raw and canonical? Usually store canonical; log normalized metadata carefully.
```

### 15.4 Confusables

Unicode confusables are hard.

Do not use visual similarity as an authorization boundary.

For security-sensitive identifiers:

```text
username
tenant slug
role name
permission key
case id
API key prefix
object storage key
```

Prefer ASCII.

Example:

```go
var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`)
```

---

## 16. Email Validation

Email validation is often overdone and underdone at the same time.

Bad:

```go
var emailRegex = regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)
```

This accepts many bad forms and rejects valid ones.

Better mental model:

```text
For login/contact identity, syntax validation is not enough.
Email ownership is established by verification flow.
```

### 16.1 Recommended Email Boundary

For most systems:

```text
1. Trim surrounding spaces.
2. Parse with net/mail or a dedicated email library.
3. Require exactly one address, no display-name if not expected.
4. Lowercase the domain.
5. Convert international domain with IDNA if supporting it.
6. Apply max length.
7. Store canonical form.
8. Verify ownership with a time-limited token.
```

Example:

```go
package boundary

import (
	"errors"
	"net/mail"
	"strings"

	"golang.org/x/net/idna"
)

type CanonicalEmail string

func ParseCanonicalEmail(raw string) (CanonicalEmail, error) {
	s := strings.TrimSpace(raw)
	if len(s) == 0 || len(s) > 254 {
		return "", errors.New("invalid email")
	}

	addr, err := mail.ParseAddress(s)
	if err != nil {
		return "", errors.New("invalid email")
	}

	// If the input grammar should not allow "Name <a@b>", require exact address.
	if addr.Name != "" {
		return "", errors.New("display name not allowed")
	}

	parts := strings.Split(addr.Address, "@")
	if len(parts) != 2 {
		return "", errors.New("invalid email")
	}

	local := parts[0]
	domain := strings.ToLower(parts[1])

	asciiDomain, err := idna.Lookup.ToASCII(domain)
	if err != nil {
		return "", errors.New("invalid email domain")
	}

	if local == "" || asciiDomain == "" {
		return "", errors.New("invalid email")
	}

	return CanonicalEmail(local + "@" + asciiDomain), nil
}
```

### 16.2 Do Not Canonicalize Provider-Specific Local Parts Globally

Do not globally do this:

```text
remove dots
remove plus tags
lowercase local part
```

Those rules are provider-specific.

For example:

```text
firstname.lastname@example.com
firstnamelastname@example.com
firstname+tag@example.com
```

May or may not be same mailbox depending on provider.

Only apply such rules if you own the domain or have explicit provider-specific policy.

---

## 17. MIME and Content-Type Validation

`Content-Type` header is user-controlled.

It is useful as a hint, not proof.

For uploaded files:

```text
extension
declared MIME
sniffed MIME
magic bytes
parser validation
business policy
AV/CDR if applicable
```

All are separate signals.

### 17.1 MIME Sniffing with `http.DetectContentType`

Example:

```go
func sniffContentType(r io.Reader) (string, []byte, error) {
	var head [512]byte

	n, err := io.ReadFull(r, head[:])
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", nil, err
	}

	ct := http.DetectContentType(head[:n])
	return ct, head[:n], nil
}
```

But if you read from the stream, you must put bytes back:

```go
func withSniffedPrefix(f multipart.File) (string, io.Reader, error) {
	var head [512]byte

	n, err := io.ReadFull(f, head[:])
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", nil, err
	}

	ct := http.DetectContentType(head[:n])
	reader := io.MultiReader(bytes.NewReader(head[:n]), f)

	return ct, reader, nil
}
```

### 17.2 Extension Allowlist

Example:

```go
var allowedExt = map[string]string{
	".pdf":  "application/pdf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
}

func validateUploadExtension(name string) (string, error) {
	base := filepath.Base(name)
	if base != name {
		return "", errors.New("path not allowed in filename")
	}

	ext := strings.ToLower(filepath.Ext(base))
	if _, ok := allowedExt[ext]; !ok {
		return "", errors.New("unsupported extension")
	}
	return ext, nil
}
```

Still:

```text
Extension allowlist is not enough.
MIME sniffing is not enough.
Parser validation is not enough.
Use layered controls.
```

---

## 18. Multipart Security

Multipart parsing is a common source of resource exhaustion.

Risks:

```text
huge body
many parts
huge headers
many files
large form fields
memory pressure
temporary disk pressure
filename traversal
content-type spoofing
parser confusion
```

### 18.1 Always Limit Request Body Before Multipart Parsing

Handler:

```go
func uploadHandler(w http.ResponseWriter, r *http.Request) {
	const maxBody = 20 << 20 // 20 MiB

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)

	if err := r.ParseMultipartForm(8 << 20); err != nil {
		http.Error(w, "invalid multipart request", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	_ = header.Filename // display metadata only; do not use as storage path
}
```

### 18.2 Safe Upload Pipeline

```mermaid
flowchart TD
    A[HTTP multipart request] --> B[MaxBytesReader]
    B --> C[ParseMultipartForm with memory limit]
    C --> D[Require expected field names]
    D --> E[Reject unexpected file count]
    E --> F[Validate original filename as display metadata only]
    F --> G[Sniff first bytes]
    G --> H[Extension allowlist]
    H --> I[MIME allowlist]
    I --> J[Generate storage object ID]
    J --> K[Write via os.Root or object storage]
    K --> L[Persist metadata]
    L --> M[AV/CDR async if required]
```

### 18.3 File Upload Invariants

```text
1. Request body has hard byte limit.
2. Number of file parts has hard limit.
3. Number of form fields has hard limit.
4. Each file has hard byte limit.
5. Original filename is metadata only.
6. Stored filename is generated by server.
7. Storage path is tenant-scoped and rooted.
8. Public retrieval uses authorization, not direct filesystem path.
9. Uploaded content is never executed.
10. Uploaded content is served with safe headers.
```

Safe serving headers:

```text
Content-Type: application/octet-stream or validated type
Content-Disposition: attachment; filename="safe-display-name.pdf"
X-Content-Type-Options: nosniff
Cache-Control: private, no-store where appropriate
```

---

## 19. Archive Traversal

Archives are dangerous because they contain paths.

A zip or tar file may contain:

```text
../../etc/passwd
/absolute/path
C:\Windows\system.ini
dir/../../evil
normal.txt
symlink -> /etc/passwd
hardlink -> ../../secret
huge file
many files
zip bomb
nested archive
```

### 19.1 Never Extract Archive Entries Blindly

Wrong:

```go
for _, f := range zr.File {
    dst := filepath.Join(outDir, f.Name)
    // create dst...
}
```

### 19.2 Secure Archive Extraction Policy

Before extraction, define:

```text
Allowed formats:
  zip only? tar only?

Allowed entry types:
  regular files only?
  directories allowed?
  symlinks forbidden?
  hardlinks forbidden?

Limits:
  max archive bytes
  max uncompressed bytes
  max file count
  max per-file bytes
  max path length
  max nesting depth

Path policy:
  slash-separated archive path
  no absolute paths
  no drive letters
  no ..
  local path only
  extract via os.Root

Output:
  generated root directory
  no executable permissions
```

### 19.3 Zip Extraction with `os.Root`

Example sketch:

```go
func ExtractZipToRoot(zr *zip.Reader, root *os.Root) error {
	const (
		maxFiles             = 1000
		maxTotalUncompressed = int64(200 << 20)
		maxFileBytes         = int64(20 << 20)
	)

	if len(zr.File) > maxFiles {
		return errors.New("too many files")
	}

	var total int64

	for _, zf := range zr.File {
		name := zf.Name

		// ZIP entry names use forward slashes.
		if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, `\`) {
			return errors.New("invalid archive path")
		}
		if !filepath.IsLocal(filepath.FromSlash(name)) {
			return errors.New("invalid archive path")
		}

		if zf.FileInfo().IsDir() {
			continue
		}

		mode := zf.FileInfo().Mode()
		if !mode.IsRegular() {
			return errors.New("unsupported archive entry type")
		}

		if zf.UncompressedSize64 > uint64(maxFileBytes) {
			return errors.New("file too large")
		}

		total += int64(zf.UncompressedSize64)
		if total > maxTotalUncompressed {
			return errors.New("archive too large")
		}

		rc, err := zf.Open()
		if err != nil {
			return err
		}

		err = func() error {
			defer rc.Close()

			dst, err := root.OpenFile(filepath.FromSlash(name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			defer dst.Close()

			lr := &io.LimitedReader{R: rc, N: maxFileBytes + 1}
			n, err := io.Copy(dst, lr)
			if err != nil {
				return err
			}
			if n > maxFileBytes || lr.N == 0 {
				return errors.New("file too large")
			}
			return nil
		}()

		if err != nil {
			return err
		}
	}

	return nil
}
```

### 19.4 Tar Is More Dangerous Than It Looks

Tar supports entry types beyond regular files:

```text
directories
symlinks
hard links
char devices
block devices
FIFOs
PAX headers
long names
```

Policy for many applications:

```text
Accept regular files only.
Reject symlinks.
Reject hard links.
Reject devices.
Reject absolute paths.
Reject parent traversal.
Set safe permissions.
```

---

## 20. JSON Parser Ambiguity

Go's `encoding/json` has documented security considerations.

Important behaviors:

```text
duplicate keys are processed in order
later values may replace or merge depending on destination type
struct field matching is case-insensitive
unknown keys are ignored unless Decoder.DisallowUnknownFields is used
invalid UTF-8 in JSON strings is replaced by Unicode replacement character
large JSON integers lose precision if decoded into floating-point types
```

This matters when JSON drives security decisions.

### 20.1 Strict JSON Decoder

Use:

```go
func DecodeStrictJSON[T any](r io.Reader, maxBytes int64) (T, error) {
	var zero T

	lr := &io.LimitedReader{R: r, N: maxBytes + 1}
	dec := json.NewDecoder(lr)
	dec.DisallowUnknownFields()
	dec.UseNumber()

	var v T
	if err := dec.Decode(&v); err != nil {
		return zero, err
	}

	if lr.N == 0 {
		return zero, errors.New("json body too large")
	}

	// Ensure there is no trailing JSON value.
	if dec.Decode(&struct{}{}) != io.EOF {
		return zero, errors.New("multiple json values not allowed")
	}

	return v, nil
}
```

### 20.2 DTO Design

Bad:

```go
type UpdateUserRequest struct {
	ID      string `json:"id"`
	Role    string `json:"role"`
	Balance int64  `json:"balance"`
	Name    string `json:"name"`
}
```

Why bad?

```text
Client can attempt to update fields that should be server-controlled.
```

Better:

```go
type UpdateProfileRequest struct {
	DisplayName string `json:"display_name"`
	Timezone    string `json:"timezone"`
}
```

Then bind server-controlled values from context:

```go
actor := ActorFromContext(ctx)
userID := actor.UserID
```

---

## 21. Query Parameter Validation

Query parameters are often forgotten.

Common risks:

```text
unbounded page size
arbitrary sort field
arbitrary filter expression
regex DoS
export too many rows
boolean confusion
array count explosion
parameter pollution
```

### 21.1 Safe Pagination

```go
type PageRequest struct {
	Limit  int
	Offset int
}

func ParsePage(q url.Values) (PageRequest, error) {
	limit := 50
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			return PageRequest{}, errors.New("invalid limit")
		}
		limit = n
	}

	offset := 0
	if raw := q.Get("offset"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 100_000 {
			return PageRequest{}, errors.New("invalid offset")
		}
		offset = n
	}

	return PageRequest{Limit: limit, Offset: offset}, nil
}
```

### 21.2 Safe Sort Fields

Wrong:

```go
orderBy := r.URL.Query().Get("sort")
query := "SELECT * FROM cases ORDER BY " + orderBy
```

Better:

```go
var sortColumns = map[string]string{
	"created_at": "created_at",
	"updated_at": "updated_at",
	"case_id":    "case_id",
}

func ParseSort(raw string) (string, error) {
	if raw == "" {
		return "created_at", nil
	}
	col, ok := sortColumns[raw]
	if !ok {
		return "", errors.New("invalid sort field")
	}
	return col, nil
}
```

Even when SQL values are parameterized, SQL identifiers cannot usually be parameterized. Use allowlist mapping.

---

## 22. Header Validation

Headers are not trusted.

Important examples:

```text
X-Forwarded-For
X-Real-IP
Forwarded
Host
Origin
Referer
Content-Type
Accept-Language
Authorization
User-Agent
```

### 22.1 Host Header

Do not use `r.Host` blindly for password reset links, redirects, or absolute URL generation.

Use configured public origin:

```go
type PublicOrigin struct {
	Scheme string
	Host   string
}

func (o PublicOrigin) ResetURL(token string) string {
	u := url.URL{
		Scheme: o.Scheme,
		Host:   o.Host,
		Path:   "/reset-password",
	}
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()
	return u.String()
}
```

### 22.2 Trusted Proxy Boundary

Only trust forwarded headers from configured proxies.

Boundary model:

```mermaid
flowchart LR
    C[Client] --> LB[Trusted Load Balancer]
    LB --> APP[Go App]

    C -. can spoof X-Forwarded-For .-> APP
    LB -- controlled headers --> APP
```

If the app is directly reachable, forwarded headers are attacker-controlled.

---

## 23. Command-like Input

Some values are not commands but behave like command fragments:

```text
sort expression
filter expression
search query
report formula
template variable
cron expression
regex pattern
file glob
SQL LIKE pattern
OpenSearch query DSL
```

Do not pass them raw to powerful interpreters.

### 23.1 Regex Input

Go's `regexp` package uses RE2-style regular expressions and avoids catastrophic backtracking in the classic PCRE sense, but attacker-provided regex can still consume CPU by being complex or applied to large input repeatedly.

Policy:

```text
Prefer fixed search modes.
If regex is required:
  set pattern length limit
  compile with timeout at request level
  apply to bounded text
  rate limit
  audit expensive patterns
```

### 23.2 Filter DSL

If product requires filters:

```text
Do not expose raw SQL/OpenSearch DSL.
Create a tiny typed DSL.
Parse into AST.
Validate allowed fields/operators.
Compile to parameterized backend query.
Limit complexity.
```

Example allowed filter:

```text
status = "OPEN" AND created_at >= "2026-01-01"
```

Not:

```text
arbitrary SQL WHERE
```

---

## 24. State Machine Validation

For regulatory and case management systems, validation must include workflow state.

Example:

```text
Can user submit appeal?
```

Not enough:

```text
request JSON is valid
actor has appeal:submit permission
case_id exists
```

Need:

```text
case is in appealable state
deadline not exceeded
actor is eligible party
no duplicate active appeal exists
required documents exist
transition is allowed by policy version
```

Mermaid:

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted: submit
    Submitted --> UnderReview: assign
    UnderReview --> Approved: approve
    UnderReview --> Rejected: reject
    Rejected --> Appealed: appeal
    Approved --> [*]
    Appealed --> UnderReview: reopen

    Draft --> Rejected: invalid direct transition
    Submitted --> Draft: invalid rollback
```

This is input validation at the domain layer.

The input may be syntactically valid but semantically invalid.

---

## 25. Canonicalization Before Signing or MAC

This part connects to part 007.

If a payload is signed or MACed, all parties must agree on exactly what bytes are protected.

Bad:

```text
Signer signs JSON string A.
Verifier parses JSON into struct and re-marshals as JSON string B.
A and B may not be byte-identical.
```

Safer:

```text
Sign exact bytes received.
Or define a formal canonicalization scheme.
```

For webhook signatures:

```text
signature = HMAC(secret, timestamp + "." + raw_body_bytes)
```

Not:

```text
signature = HMAC(secret, parsed_struct.String())
```

For request signing:

```text
method + "\n" +
canonical_path + "\n" +
canonical_query + "\n" +
canonical_headers + "\n" +
body_hash
```

Every component must be precisely defined.

---

## 26. Validation and Authorization Must Not Race

TOCTOU pattern:

```go
if isAllowed(user, filePath) {
    return os.Open(filePath)
}
```

Between check and use, the file may change.

Better:

```text
Use a primitive where validation and use are tied.
```

For filesystem paths, `os.Root` helps.

For database objects:

```sql
SELECT *
FROM cases
WHERE case_id = ?
  AND tenant_id = ?
```

Not:

```text
SELECT case by id
then separately check tenant
then use stale object
```

For state transitions:

```sql
UPDATE cases
SET status = 'SUBMITTED'
WHERE case_id = ?
  AND tenant_id = ?
  AND status = 'DRAFT'
```

Check affected rows.

This makes validation, authorization, and transition atomic.

---

## 27. Resource Bounds Are Validation

A request can be valid but too expensive.

Always validate:

```text
body size
header size
query count
array length
map key count
nesting depth
string length
file count
archive entry count
uncompressed size
timeout
pagination limit
export limit
rate
tenant quota
```

Example JSON array limit:

```go
type BulkRequest struct {
	Items []Item `json:"items"`
}

func (r BulkRequest) Validate() error {
	if len(r.Items) == 0 || len(r.Items) > 100 {
		return errors.New("invalid item count")
	}
	for i := range r.Items {
		if err := r.Items[i].Validate(); err != nil {
			return err
		}
	}
	return nil
}
```

---

## 28. Validation Layering

Validation belongs in multiple layers, with different responsibilities.

| Layer | Responsibility |
|---|---|
| Edge/gateway | coarse size/rate/authentication |
| HTTP handler | parse transport input |
| Boundary parser | canonicalize and validate shape |
| Application service | bind actor/tenant and enforce use-case constraints |
| Domain model | enforce invariants |
| Repository | enforce scoped query/update |
| Database | constraints, unique indexes, FK, check constraints |
| Audit | record security-relevant validation failures |

Diagram:

```mermaid
flowchart TD
    A[Gateway] --> B[HTTP handler]
    B --> C[Boundary parser]
    C --> D[Application service]
    D --> E[Domain model]
    E --> F[Repository]
    F --> G[Database constraints]
    D --> H[Audit trail]
```

Do not rely on only one layer.

---

## 29. Domain Value Objects

A top-tier Go codebase uses tiny types to prevent raw string leakage.

Example:

```go
type TenantID struct {
	value string
}

func ParseTenantID(raw string) (TenantID, error) {
	if !tenantIDPattern.MatchString(raw) {
		return TenantID{}, errors.New("invalid tenant id")
	}
	return TenantID{value: raw}, nil
}

func (id TenantID) String() string {
	return id.value
}
```

Why struct instead of alias?

```go
type TenantID string
```

An alias-like named string is easy to construct:

```go
id := TenantID(raw)
```

A struct with unexported field forces constructor usage outside package.

This is stronger.

---

## 30. Validation Testing Strategy

### 30.1 Table Tests

```go
func TestParseCaseID(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		ok   bool
	}{
		{"valid", "CASE-000000000001", true},
		{"lowercase", "case-000000000001", false},
		{"short", "CASE-1", false},
		{"traversal", "../CASE-000000000001", false},
		{"unicode", "CASE-０００００００００００１", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseCaseID(tt.raw)
			if (err == nil) != tt.ok {
				t.Fatalf("ok=%v err=%v", tt.ok, err)
			}
		})
	}
}
```

### 30.2 Fuzzing

Go fuzzing is excellent for parsers.

```go
func FuzzParseUploadName(f *testing.F) {
	seeds := []string{
		"file.pdf",
		"../secret",
		"..\\secret",
		"/etc/passwd",
		"C:\\Windows\\system.ini",
		"file.pdf%00.exe",
		"résumé.pdf",
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, raw string) {
		name, err := ParseUploadName(raw)
		if err != nil {
			return
		}
		if strings.Contains(name.String(), "..") {
			t.Fatalf("accepted traversal-like name: %q", name)
		}
	})
}
```

### 30.3 Golden Corpus

Maintain a corpus:

```text
testdata/security/url_corpus.txt
testdata/security/path_corpus.txt
testdata/security/unicode_corpus.txt
testdata/security/archive_corpus.zip
testdata/security/json_ambiguity.json
```

Include known bypass patterns.

---

## 31. Observability for Validation

Validation failures are security signals.

Log structured fields:

```text
event_type=validation_failed
boundary=http.case.get
field=case_id
reason=invalid_format
actor_id=...
tenant_id=...
remote_ip_class=...
request_id=...
```

Do not log:

```text
raw password
raw token
raw secret
full uploaded file content
full bearer token
unredacted PII
huge raw payload
```

Metric examples:

```text
validation_failures_total{boundary,field,reason}
multipart_rejected_total{reason}
archive_rejected_total{reason}
json_unknown_field_total{endpoint,field}
request_body_too_large_total{endpoint}
```

Alert examples:

```text
many path traversal attempts
many archive bombs
many invalid tokens
many unknown admin fields
many high page-size attempts
```

---

## 32. Common Anti-Patterns

### 32.1 `strings.Contains(s, "..")`

This is not robust.

Problems:

```text
encoding
normalization
platform differences
false positives
false negatives
symlinks
```

### 32.2 `filepath.Clean` as Security

Normalization is not containment.

### 32.3 Trusting Browser Validation

Client-side validation is UX only.

Attackers do not use your browser.

### 32.4 Trusting Content-Type

The header is controlled by the sender.

### 32.5 Global "Sanitize"

Usually destroys legitimate data and still misses security context.

### 32.6 Decode Twice

Double decoding creates bypasses.

Example:

```text
%252e%252e%252f
decode once -> %2e%2e%2f
decode twice -> ../
```

Define exactly where decoding happens.

### 32.7 Validate Before Canonicalization

If two representations mean the same thing, validate the canonical representation.

But beware:

```text
Some canonicalization steps can change meaning.
```

So the sequence must be explicitly designed.

### 32.8 Authorization on Raw ID, Query on Normalized ID

This causes mismatch.

Authorize the same canonical value that will be used.

---

## 33. Production Checklist

Use this checklist in PR/design review.

### 33.1 General Input Boundary

```text
[ ] Is every external input source identified?
[ ] Is there a typed boundary object?
[ ] Are raw strings prevented from crossing into domain logic?
[ ] Are parse, normalize, validate, authorize, and encode stages separated?
[ ] Is validation context-specific, not generic "safe string"?
[ ] Are length and count limits explicit?
[ ] Are error responses generic enough?
[ ] Are validation failures logged safely?
[ ] Are suspicious failures auditable?
```

### 33.2 URL

```text
[ ] Is URL parsed with net/url?
[ ] Is scheme allowlisted?
[ ] Is userinfo rejected?
[ ] Is host validated using Hostname(), not raw Host?
[ ] Is port validated separately?
[ ] Are redirects allowlisted or represented by server-side IDs?
[ ] Are path/query values escaped with correct escaping function?
[ ] Is SSRF handled beyond syntax validation?
```

### 33.3 Filesystem Path

```text
[ ] Is user filename treated as metadata, not storage path?
[ ] Are generated storage names used?
[ ] Is filepath.IsLocal used for relative path validation?
[ ] Is os.Root used where traversal resistance is required?
[ ] Are symlink and TOCTOU risks considered?
[ ] Are permissions restrictive?
[ ] Are platform-specific Windows names considered?
```

### 33.4 Unicode

```text
[ ] Is invalid UTF-8 rejected where text is expected?
[ ] Is normalization policy explicit?
[ ] Are security-sensitive identifiers ASCII-only unless necessary?
[ ] Are byte limits applied?
[ ] Are visual confusables not used as security boundary?
```

### 33.5 Multipart and Upload

```text
[ ] Is request body size limited before parsing?
[ ] Are file count and field count limited?
[ ] Is original filename stored only as metadata?
[ ] Are extension, MIME, magic bytes, and parser validation layered?
[ ] Are files stored outside webroot or behind authorization?
[ ] Are safe response headers used when serving uploaded files?
```

### 33.6 Archive

```text
[ ] Are archive paths validated before extraction?
[ ] Are absolute paths rejected?
[ ] Is parent traversal rejected?
[ ] Are symlinks/hardlinks/devices rejected unless explicitly needed?
[ ] Are file count and uncompressed size bounded?
[ ] Is extraction performed via os.Root or equivalent containment?
```

### 33.7 JSON

```text
[ ] Is body size limited?
[ ] Is DisallowUnknownFields used where appropriate?
[ ] Is UseNumber used when precision matters?
[ ] Are duplicate-key semantics understood?
[ ] Are server-controlled fields absent from client DTOs?
[ ] Is exactly one JSON value accepted?
```

---

## 34. Capstone: Secure Case Attachment Upload Boundary

### 34.1 Requirements

A regulatory case management system accepts PDF attachments for a case.

Security requirements:

```text
1. Only authenticated users may upload.
2. User must have permission on the case.
3. Case must be in a state where upload is allowed.
4. Upload body max 20 MiB.
5. Only one file per request.
6. Only PDF accepted.
7. Original filename must not control storage path.
8. Stored file ID generated by server.
9. File stored tenant-scoped.
10. Audit event records actor, case, file ID, size, hash, validation result.
```

### 34.2 Boundary Flow

```mermaid
sequenceDiagram
    participant Client
    participant Handler
    participant Boundary
    participant Authz
    participant Domain
    participant Store
    participant Audit

    Client->>Handler: multipart POST /cases/{case_id}/attachments
    Handler->>Boundary: Parse case_id
    Boundary-->>Handler: CaseID
    Handler->>Authz: CanUploadAttachment(actor, CaseID)
    Authz-->>Handler: allowed
    Handler->>Domain: Check case state
    Domain-->>Handler: upload allowed
    Handler->>Boundary: Parse multipart with limits
    Boundary-->>Handler: ValidUpload
    Handler->>Store: Write generated object ID
    Store-->>Handler: stored metadata
    Handler->>Audit: attachment_uploaded
    Handler-->>Client: 201 Created
```

### 34.3 Simplified Code Sketch

```go
type AttachmentUpload struct {
	DisplayName string
	ContentType string
	Size        int64
	Reader      io.Reader
}

func ParseAttachmentUpload(w http.ResponseWriter, r *http.Request) (AttachmentUpload, error) {
	const maxBody = 20 << 20

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)

	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return AttachmentUpload{}, errors.New("invalid multipart")
	}

	files := r.MultipartForm.File["file"]
	if len(files) != 1 {
		return AttachmentUpload{}, errors.New("exactly one file required")
	}

	header := files[0]

	displayName, err := ParseDisplayFilename(header.Filename)
	if err != nil {
		return AttachmentUpload{}, err
	}

	file, err := header.Open()
	if err != nil {
		return AttachmentUpload{}, err
	}

	ct, reader, err := sniffAndRestore(file)
	if err != nil {
		_ = file.Close()
		return AttachmentUpload{}, err
	}

	if ct != "application/pdf" {
		_ = file.Close()
		return AttachmentUpload{}, errors.New("unsupported file type")
	}

	return AttachmentUpload{
		DisplayName: displayName.String(),
		ContentType: ct,
		Reader:      readCloserReader{Reader: reader, Closer: file},
	}, nil
}
```

The actual production version should:

```text
hash while streaming
limit per-file bytes
close reader safely
write to temp object
commit atomically
run AV/CDR if required
persist metadata transactionally
```

---

## 35. How This Connects to the Next Parts

This part gives the input boundary foundation.

Next:

```text
part-022: Injection defense
```

That part will build on this one.

The bridge:

```text
Input validation reduces malicious shape.
Output/context encoding prevents interpreter injection.
Parameterized APIs prevent code/data confusion.
Authorization prevents valid input from being abused.
```

Do not expect input validation alone to stop SQL injection, command injection, template injection, log injection, or header injection. It helps, but it is not the main defense.

---

## 36. Key Takeaways

1. Input validation is about creating one safe domain interpretation.
2. Always distinguish parse, normalize, validate, authorize, and encode.
3. Raw strings should not travel deep into Go services.
4. Use typed constructors for domain values.
5. Validate for the consumer context.
6. URL validation must use parsed components, not string prefixes.
7. Filesystem security needs containment, preferably `os.Root`, not just path cleaning.
8. Unicode should be explicit: valid UTF-8, normalization policy, ASCII for sensitive identifiers.
9. Upload security is layered: size, count, name, MIME, signature, storage, authorization.
10. Archive extraction is filesystem access; treat it as high risk.
11. JSON parser behavior matters for security.
12. Resource bounds are part of validation.
13. Validation failures are observability and audit signals.
14. Server-side validation is mandatory; client-side validation is UX only.
15. The safest validation design makes invalid states unrepresentable.

---

## 37. References

- Go `net/url` package documentation: `https://pkg.go.dev/net/url`
- Go `path/filepath` package documentation: `https://pkg.go.dev/path/filepath`
- Go `os.Root` documentation: `https://pkg.go.dev/os#Root`
- Go blog, "Traversal-resistant file APIs": `https://go.dev/blog/osroot`
- Go `encoding/json` package security considerations: `https://pkg.go.dev/encoding/json`
- Go `mime/multipart` package documentation: `https://pkg.go.dev/mime/multipart`
- Go `net/http.DetectContentType`: `https://pkg.go.dev/net/http#DetectContentType`
- Go `archive/zip` package documentation: `https://pkg.go.dev/archive/zip`
- Go `archive/tar` package documentation: `https://pkg.go.dev/archive/tar`
- Go `unicode/utf8` package documentation: `https://pkg.go.dev/unicode/utf8`
- Go `net/mail` package documentation: `https://pkg.go.dev/net/mail`
- `golang.org/x/text/unicode/norm`: `https://pkg.go.dev/golang.org/x/text/unicode/norm`
- `golang.org/x/net/idna`: `https://pkg.go.dev/golang.org/x/net/idna`
- OWASP Input Validation Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html`
- OWASP File Upload Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html`

---

## 38. Progress

```text
[done] part-000 sampai part-021
[next] part-022 — Injection defense: SQL injection, command injection, template injection, LDAP-like filter injection, log injection, header injection, CRLF, and structured escaping
[remaining] part-023 sampai part-034
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-security-cryptography-integrity-part-020.md">⬅️ Part 020 — API Security in Go: BOLA/IDOR, Broken Function Authorization, Mass Assignment, Object Property Authorization, Rate Limit, Quota, and OWASP API Security Top 10 2023 Mapping</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-security-cryptography-integrity-part-022.md">0. Why This Part Exists ➡️</a>
</div>
