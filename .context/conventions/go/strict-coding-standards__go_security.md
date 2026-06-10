# Strict Coding Standards — Go Security

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, APIs, CLIs, workers, schedulers, event processors, integration adapters, regulatory workflow systems  
Baseline: Go 1.24–1.26+, security-first implementation, `govulncheck` as mandatory gate

---

## 1. Purpose

Security in Go code is not a separate final review step. It is part of API design, input handling, data modelling, error handling, logging, dependency selection, concurrency, filesystem access, network access, and build/release discipline.

The LLM MUST treat every implementation as potentially security-sensitive until proven otherwise.

The goal of this standard is to force the agent to produce Go code that is:

- least-privilege by default,
- explicit about trust boundaries,
- resistant to injection and confused-deputy bugs,
- safe under malformed input,
- safe under large or adversarial input,
- careful with secrets and credentials,
- auditable without leaking sensitive data,
- dependency-aware,
- compatible with vulnerability scanning,
- defensible in regulated case-management and workflow systems.

The LLM MUST NOT implement shortcuts that are convenient for development but unsafe in production unless the code is clearly isolated to tests, examples, or local-only tooling.

---

## 2. Source authority

Primary references:

- Go Security documentation: https://go.dev/doc/security/
- Go Vulnerability Management: https://go.dev/doc/security/vuln/
- Go Security Policy: https://go.dev/doc/security/policy
- Go FIPS 140-3 compliance documentation: https://go.dev/doc/security/fips140
- Go `govulncheck` tutorial: https://go.dev/doc/tutorial/govulncheck
- Go `net/http` package documentation: https://pkg.go.dev/net/http
- Go `os` package documentation, including `os.Root`: https://pkg.go.dev/os
- Go `io` package documentation: https://pkg.go.dev/io
- Go `database/sql` package documentation: https://pkg.go.dev/database/sql
- Go `html/template` package documentation: https://pkg.go.dev/html/template
- Go `text/template` package documentation: https://pkg.go.dev/text/template
- Go `crypto/tls` package documentation: https://pkg.go.dev/crypto/tls
- Go `crypto/x509` package documentation: https://pkg.go.dev/crypto/x509
- Go `crypto/subtle` package documentation: https://pkg.go.dev/crypto/subtle
- Go `log/slog` package documentation: https://pkg.go.dev/log/slog
- Go fuzzing documentation: https://go.dev/doc/security/fuzz

If this document conflicts with a project-specific security policy, the stricter rule wins. If the conflict is material, the LLM MUST report it before changing code.

---

## 3. Security decision model for LLM code agents

Before writing or modifying Go code, the LLM MUST classify the change.

| Question                                                                                                    | Required action                                                             |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Does the code receive external input?                                                                       | Add size limits, validation, parsing error handling, and negative tests.    |
| Does the code call a database, shell, filesystem, network, template, or serializer?                         | Treat it as an injection boundary.                                          |
| Does the code handle identity, tenant, user, role, credential, token, session, certificate, key, or secret? | Treat it as security-critical.                                              |
| Does the code cross service, process, network, tenant, or privilege boundary?                               | Add explicit authorization and audit semantics.                             |
| Does the code log, trace, or return error details?                                                          | Add redaction and stable public error mapping.                              |
| Does the code create goroutines, queues, or retry loops?                                                    | Add cancellation, backpressure, and resource exhaustion controls.           |
| Does the code add dependencies or tools?                                                                    | Justify dependency, pin version, run vulnerability checks.                  |
| Does the code touch cryptography?                                                                           | Follow `strict-coding-standards__go_cryptography.md`; do not invent crypto. |

The LLM MUST include security consequences in the implementation notes or PR summary when any answer is yes.

---

## 4. Non-negotiable security rules

### 4.1 Never trust external input

External input includes:

- HTTP request path, query, headers, cookies, and body,
- CLI arguments and environment variables,
- files, archives, and uploaded multipart content,
- queue messages and events,
- database content that originated outside the service,
- cache content,
- third-party API responses,
- webhook payloads,
- XML, JSON, CSV, YAML, form data, protobuf, and binary payloads,
- object storage keys and filenames,
- tenant/user/role IDs provided by clients.

Required pattern:

```go
type CreateCaseRequest struct {
	LicenseID string `json:"license_id"`
	Reason    string `json:"reason"`
}

func DecodeCreateCaseRequest(r io.Reader, maxBytes int64) (CreateCaseRequest, error) {
	var req CreateCaseRequest
	dec := json.NewDecoder(io.LimitReader(r, maxBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return CreateCaseRequest{}, fmt.Errorf("decode create case request: %w", err)
	}
	if err := validateCreateCaseRequest(req); err != nil {
		return CreateCaseRequest{}, err
	}
	return req, nil
}
```

Rules:

- Validate at the boundary.
- Validate again at the domain invariant boundary.
- Do not treat client-provided IDs, statuses, role names, tenant IDs, or workflow states as authoritative.
- Do not trust data just because it came through an internal queue or service.

---

### 4.2 Use allowlists, not denylists

Security-sensitive validation MUST be allowlist-based.

Forbidden:

```go
if strings.Contains(name, "../") {
	return errors.New("invalid name")
}
```

Preferred:

```go
var safeName = regexp.MustCompile(`\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\z`)

func ValidateObjectName(name string) error {
	if !safeName.MatchString(name) {
		return errors.New("invalid object name")
	}
	return nil
}
```

Rules:

- Define allowed character set, length, normalization, and semantic constraints.
- Reject ambiguous Unicode where identity/security comparison is involved unless the project has a normalization policy.
- Denylists MAY be used only as an additional layer, never as the primary guard.

---

### 4.3 Bound all untrusted input

The LLM MUST bound size, depth, count, concurrency, and time.

Required controls:

- HTTP body size limit via `http.MaxBytesReader` or bounded reader.
- File read limit for untrusted files.
- Archive entry count and expanded-size limit.
- XML/JSON token limit when streaming.
- Database page size maximum.
- Goroutine and queue bound.
- Timeout and cancellation on external I/O.
- Retry limit and backoff cap.

Forbidden:

```go
body, err := io.ReadAll(r.Body) // unbounded external request body
```

Preferred:

```go
const maxRequestBody = 1 << 20 // choose per endpoint
r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
body, err := io.ReadAll(r.Body)
if err != nil {
	return fmt.Errorf("read bounded request body: %w", err)
}
```

---

### 4.4 Do not leak sensitive data

The LLM MUST classify data before logging, returning, storing, tracing, or exposing it.

Sensitive data includes:

- password, passphrase, API key, token, session ID,
- OAuth/OIDC/SAML assertions,
- private key, certificate private material,
- OTP, recovery code, reset token,
- PII, NRIC/passport/government ID, address, phone, email,
- financial identifiers,
- investigation, enforcement, case, complaint, or disciplinary details,
- internal infrastructure URL if exposure increases attack surface,
- raw request body from untrusted sources.

Forbidden:

```go
slog.Error("login failed", "request", req, "err", err)
```

Required:

```go
slog.WarnContext(ctx, "login failed",
	"user_hash", stableUserHash(req.Username),
	"reason", publicReason(err),
	"correlation_id", correlationID(ctx),
)
```

Rules:

- Never log secrets.
- Never log raw bearer tokens, cookies, authorization headers, private keys, or full certificates with private material.
- Never return internal stack traces or SQL/driver details to clients.
- Logs used for audit MUST be stable, structured, and redacted.
- Traces and metrics MUST obey the same redaction rules as logs.

---

### 4.5 Fail closed for authorization

Authorization MUST fail closed.

Forbidden:

```go
allowed, _ := authz.CanApprove(ctx, user, caseID)
if allowed {
	approve()
}
```

Required:

```go
allowed, err := authz.CanApprove(ctx, user, caseID)
if err != nil {
	return fmt.Errorf("check approve permission: %w", err)
}
if !allowed {
	return ErrForbidden
}
```

Rules:

- Authorization checks MUST be explicit near the use case boundary.
- Role names from client input are not trusted.
- Tenant/case ownership MUST be verified server-side.
- Cache-based authorization MUST define TTL, invalidation, and stale-deny behavior.
- Missing identity MUST be unauthenticated, not anonymous-with-permission.

---

### 4.6 Separate authentication, authorization, and audit

The LLM MUST NOT collapse these concerns.

| Concern        | Question                                             | Output                       |
| -------------- | ---------------------------------------------------- | ---------------------------- |
| Authentication | Who is the actor?                                    | identity/principal           |
| Authorization  | May this actor perform this action on this resource? | allow/deny with reason class |
| Audit          | What happened and why is it defensible?              | immutable/security log event |

Rules:

- Authentication middleware MUST NOT make final business authorization decisions.
- Authorization function MUST NOT mutate business state.
- Audit log MUST record successful security-sensitive actions and material denials where required by policy.
- Public error response MUST not reveal whether a hidden resource exists unless contract allows it.

---

### 4.7 Never build SQL by concatenating untrusted input

Forbidden:

```go
query := "SELECT * FROM cases WHERE id = '" + id + "'"
rows, err := db.QueryContext(ctx, query)
```

Required:

```go
row := db.QueryRowContext(ctx,
	`SELECT id, status, updated_at FROM cases WHERE id = $1`,
	id,
)
```

Rules:

- Values MUST be parameterized.
- Identifiers such as table names, column names, sort columns, and direction MUST be selected from allowlists.
- Dynamic filters MUST be assembled with parameter placeholders and a tracked argument list.
- Do not parameterize SQL keywords; allowlist them.
- Do not log full SQL with raw argument values if arguments can be sensitive.

Allowed dynamic sort example:

```go
var sortColumns = map[string]string{
	"created_at": "created_at",
	"status":     "status",
}

func sortClause(input string, desc bool) (string, error) {
	col, ok := sortColumns[input]
	if !ok {
		return "", ErrInvalidSort
	}
	dir := "ASC"
	if desc {
		dir = "DESC"
	}
	return " ORDER BY " + col + " " + dir, nil
}
```

---

### 4.8 Do not execute shell commands with untrusted input

The LLM MUST avoid shell execution. Use Go APIs directly where possible.

Forbidden:

```go
cmd := exec.Command("sh", "-c", "convert " + fileName)
```

Preferred:

```go
cmd := exec.CommandContext(ctx, "convert", "--", inputPath, outputPath)
cmd.Dir = workingDir
cmd.Env = minimalEnv()
```

Rules:

- Do not use `sh -c`, `cmd /C`, or shell interpolation for untrusted values.
- Use `exec.CommandContext` with timeout/cancellation.
- Pass arguments as separate argv entries.
- Validate executable path; do not rely on attacker-controlled `PATH`.
- Use a minimal environment.
- Bound stdout/stderr.
- Drop privileges or sandbox outside Go if executing complex external tools.

---

### 4.9 Handle filesystems as hostile boundaries

The LLM MUST protect against path traversal, symlink confusion, race conditions, unexpected file types, and unsafe permissions.

Forbidden:

```go
path := filepath.Join(uploadDir, r.URL.Query().Get("name"))
f, err := os.Open(path)
```

Required for untrusted names:

```go
func openUploaded(root *os.Root, name string) (*os.File, error) {
	if err := ValidateObjectName(name); err != nil {
		return nil, err
	}
	return root.Open(name)
}
```

Rules:

- Prefer `os.Root` for directory-scoped filesystem operations when available.
- Reject absolute paths from clients.
- Reject `..` path traversal.
- Do not follow symlinks unless explicitly allowed and safe.
- Use restrictive permissions for created files and directories.
- Check file type when behavior depends on regular file vs directory vs symlink.
- Use atomic write pattern for important files: temp file in same directory, fsync where required, rename.
- Do not extract archives without canonical path checks, entry count limit, size limit, and permission normalization.

---

### 4.10 Use safe templates by default

For HTML output, the LLM MUST use `html/template`, not `text/template`.

Forbidden:

```go
tmpl := texttemplate.Must(texttemplate.New("page").Parse(`<div>{{.Name}}</div>`))
```

Required:

```go
tmpl := template.Must(template.New("page").Parse(`<div>{{.Name}}</div>`))
```

Rules:

- Use `html/template` for HTML, JavaScript, CSS, and URI contexts.
- Do not mark content as `template.HTML`, `template.JS`, or `template.URL` unless it comes from a trusted sanitizer or static source.
- Never concatenate HTML manually from untrusted input.
- For SQL, shell, LDAP, and other languages, template escaping is not sufficient; use domain-specific safe APIs.

---

### 4.11 Use safe HTTP client and server defaults

The LLM MUST not create network code without timeouts, limits, and TLS rules.

Required HTTP client pattern:

```go
client := &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	},
}
```

Required server pattern:

```go
srv := &http.Server{
	Addr:              addr,
	Handler:           handler,
	ReadHeaderTimeout: 5 * time.Second,
	ReadTimeout:       15 * time.Second,
	WriteTimeout:      30 * time.Second,
	IdleTimeout:       60 * time.Second,
}
```

Rules:

- Do not use package-level `http.Get`, `http.Post`, or `http.DefaultClient` in production code unless wrapped with explicit timeout and policy.
- Set server read/header/write/idle timeouts.
- Validate redirects when tokens or credentials are involved.
- Limit response body size from external services.
- Propagate `context.Context` into outbound requests.
- Do not disable TLS verification.

Forbidden:

```go
tr := &http.Transport{
	TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
}
```

---

### 4.12 Do not use unsafe crypto or security primitives casually

Security-sensitive code MUST follow `strict-coding-standards__go_cryptography.md`.

Forbidden:

```go
hash := md5.Sum([]byte(password))
```

Forbidden:

```go
if providedToken == expectedToken {
	// timing leak for secrets
}
```

Required:

```go
if subtle.ConstantTimeCompare(providedMAC, expectedMAC) != 1 {
	return ErrInvalidMAC
}
```

Rules:

- `math/rand` MUST NOT be used for security tokens, identifiers, nonces, passwords, or keys.
- Use `crypto/rand` for security randomness.
- Do not invent password hashing; use approved password hashing libraries and parameters.
- Do not implement custom encryption formats without cryptographic review.
- Do not use MD5/SHA-1 for security decisions.
- Use constant-time comparison for secrets of equal public length.

---

### 4.13 Dependencies are part of the attack surface

The LLM MUST justify every new dependency.

Required dependency checklist:

- Is the standard library sufficient?
- Is the module maintained?
- Is the license acceptable?
- Is the module tagged with stable semantic versions?
- Is the API small enough for review?
- Does the module pull risky transitive dependencies?
- Does `govulncheck ./...` report reachable vulnerabilities?
- Is the dependency required at runtime or only as a tool?
- Can it be isolated behind an adapter?

Forbidden:

```text
Add a large framework only to parse one field or format one string.
```

Required gates:

```bash
go mod tidy
go test ./...
govulncheck ./...
```

Rules:

- Pin tool dependencies using `go.mod` tool management where supported.
- Do not vendor random copied code from blogs or gists.
- Do not commit generated dependency code unless project policy requires it.
- Do not hide vulnerable dependencies behind `replace` without documented reason.

---

### 4.14 Use vulnerability scanning as a merge gate

The LLM MUST treat vulnerability scanning as required for security-relevant changes and dependency changes.

Required:

```bash
govulncheck ./...
```

Rules:

- A clean `go test` is not enough.
- A vulnerability that is not reachable MAY still require upgrade depending on policy, but reachable vulnerabilities MUST be fixed or explicitly risk-accepted by humans.
- Do not suppress scanner output silently.
- Do not upgrade major dependencies blindly; run compatibility tests.

---

### 4.15 Do not expose internal error details to clients

Forbidden:

```go
http.Error(w, err.Error(), http.StatusInternalServerError)
```

Required:

```go
slog.ErrorContext(ctx, "create case failed", "err", err, "correlation_id", correlationID(ctx))
writeProblem(w, http.StatusInternalServerError, "internal_error", "The request could not be processed.")
```

Rules:

- Public error code MUST be stable and safe.
- Internal error details go to redacted structured logs.
- Authorization errors MUST not reveal hidden resource existence unless contract allows it.
- Validation errors MAY expose field-level details only after redaction and safe formatting.

---

### 4.16 Design security audit events explicitly

Security-sensitive actions MUST produce audit events when required by project policy.

Examples:

- login success/failure,
- password/token reset,
- role/permission change,
- case assignment/reassignment,
- state transition approval/rejection,
- override/waiver/manual intervention,
- data export/download,
- bulk update/delete,
- configuration change,
- failed authorization for sensitive action.

Required audit event fields:

| Field            | Rule                               |
| ---------------- | ---------------------------------- |
| event_id         | globally unique                    |
| occurred_at      | UTC timestamp                      |
| actor_id         | authenticated server-side identity |
| actor_type       | user/system/service                |
| action           | stable enum-like name              |
| resource_type    | stable enum-like name              |
| resource_id      | server-side resource id            |
| decision/outcome | success/denied/failure             |
| reason_code      | stable safe reason                 |
| correlation_id   | request/workflow correlation       |
| tenant/scope     | explicit if multi-tenant           |

Rules:

- Do not put raw secrets or sensitive document contents in audit event fields.
- Audit event generation MUST be tied to state mutation success/failure semantics.
- Audit events MUST be idempotent or deduplicatable for retried workflows.

---

## 5. Authentication and session handling

### 5.1 Do not hand-roll authentication protocols

The LLM MUST not invent login/session/token protocols when an approved platform exists.

Rules:

- Prefer proven OAuth2/OIDC/SAML/session infrastructure defined by architecture.
- Validate issuer, audience, expiry, not-before, signature, algorithm, key id, and tenant/scope.
- Do not accept unsigned tokens.
- Do not accept `alg=none` or algorithm chosen by attacker.
- Do not trust claims until the token is fully verified.
- Treat JWT as signed claims, not encrypted data.
- Do not store bearer tokens in logs or traces.

### 5.2 Cookies must be secure by default

Required for sensitive cookies:

```go
http.SetCookie(w, &http.Cookie{
	Name:     "session",
	Value:    sessionID,
	Path:     "/",
	Secure:   true,
	HttpOnly: true,
	SameSite: http.SameSiteLaxMode,
})
```

Rules:

- Use `Secure`, `HttpOnly`, and appropriate `SameSite`.
- Set explicit expiration/max-age according to session policy.
- Rotate session IDs after privilege changes.
- Never store sensitive data directly in client-side cookies unless encrypted/authenticated by an approved mechanism.

---

## 6. Authorization and workflow security

### 6.1 Model permissions as domain policy, not scattered booleans

Forbidden:

```go
if user.Role == "admin" || user.ID == case.OwnerID {
	approve()
}
```

Required:

```go
if err := policy.CanApproveCase(actor, c); err != nil {
	return err
}
return workflow.Approve(ctx, c.ID, actor.ID)
```

Rules:

- Put authorization decisions in explicit policy functions or services.
- Authorization MUST consider actor, action, resource, state, tenant/scope, and exceptional override rules.
- Never rely on frontend-hidden buttons as enforcement.
- Never trust workflow status submitted by client.

### 6.2 State transitions are security boundaries

Every state transition in regulatory/enforcement workflows MUST validate:

- current state,
- requested transition,
- actor authorization,
- required evidence/documents,
- deadline/lock/freeze constraints,
- idempotency key or duplicate prevention,
- audit event semantics,
- version/concurrency check.

Required transition shape:

```go
func (s *Service) ApproveCase(ctx context.Context, cmd ApproveCaseCommand) error {
	actor, err := s.identity.Actor(ctx)
	if err != nil {
		return ErrUnauthenticated
	}

	return s.tx.Run(ctx, func(ctx context.Context) error {
		c, err := s.cases.GetForUpdate(ctx, cmd.CaseID)
		if err != nil {
			return err
		}
		if err := s.policy.CanApprove(actor, c); err != nil {
			return err
		}
		if err := c.Approve(cmd.Reason, actor.ID); err != nil {
			return err
		}
		return s.cases.Save(ctx, c)
	})
}
```

---

## 7. Input parsing standards

### 7.1 JSON

- Use strict DTOs.
- Use body size limit.
- Use `DisallowUnknownFields()` by default for requests/config.
- Reject trailing values unless streaming protocol allows them.
- Preserve optional/null/zero semantics intentionally.
- Do not decode into `map[string]any` unless schema is intentionally dynamic.

### 7.2 XML

- Treat XML as high-risk integration input.
- Use bounded readers and token-level parsing for large documents.
- Validate root element and namespace.
- Do not use `innerxml` for untrusted XML.
- Do not concatenate XML strings.

### 7.3 Forms and multipart

- Bound multipart memory and file sizes.
- Validate filename separately from content.
- Do not use client filename as storage path.
- Sniffing MIME type is not authorization; content type must be validated according to business rule.

### 7.4 URLs

- Parse with `net/url`.
- Validate scheme, host, path, and port according to allowlist.
- Prevent SSRF by rejecting internal/private/link-local/metadata IP ranges where relevant.
- Re-resolve and validate DNS/IP at connection time for high-risk outbound calls.
- Do not allow arbitrary redirect targets.

---

## 8. SSRF and outbound network controls

The LLM MUST treat user-controlled outbound URLs as SSRF risk.

Forbidden:

```go
resp, err := http.Get(req.CallbackURL)
```

Required policy:

```go
type OutboundURLPolicy struct {
	AllowedSchemes map[string]struct{}
	AllowedHosts   map[string]struct{}
}

func (p OutboundURLPolicy) Validate(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, ErrInvalidURL
	}
	if _, ok := p.AllowedSchemes[u.Scheme]; !ok {
		return nil, ErrURLSchemeNotAllowed
	}
	if _, ok := p.AllowedHosts[strings.ToLower(u.Hostname())]; !ok {
		return nil, ErrURLHostNotAllowed
	}
	return u, nil
}
```

Rules:

- Use allowlisted hosts for callbacks/webhooks/integrations whenever possible.
- Reject IP literals unless explicitly needed and reviewed.
- Reject localhost, loopback, private, link-local, multicast, and cloud metadata ranges for user-controlled outbound calls.
- Limit redirects and revalidate redirect targets.
- Use a dedicated HTTP client with timeouts and body limits.

---

## 9. Resource exhaustion controls

Security includes availability.

The LLM MUST prevent:

- unbounded memory growth,
- unbounded goroutines,
- unbounded channels,
- unbounded retries,
- unbounded file descriptors,
- unbounded decompression,
- unbounded regex cost,
- unbounded database result sets,
- unbounded logging volume.

Required:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

sem := make(chan struct{}, maxConcurrent)
```

Rules:

- Every external operation needs timeout/cancellation.
- Every worker pool needs a maximum.
- Every queue needs capacity or backpressure policy.
- Every list endpoint needs max page size.
- Every import job needs batch limits and checkpointing.
- Every decompression flow needs compressed and uncompressed limits.

---

## 10. Concurrency security

The LLM MUST treat races as security bugs when shared state influences permission, identity, payment, workflow transition, audit, or case outcome.

Rules:

- Run `go test -race ./...` for concurrency/security-sensitive changes.
- Do not store mutable identity or permission state in package-level variables.
- Do not cache authorization decisions without explicit invalidation.
- Do not mutate maps from multiple goroutines without synchronization.
- Do not share request-scoped buffers across goroutines after reuse.
- Ensure background goroutines stop on context cancellation.

---

## 11. Secrets management

### 11.1 Do not hardcode secrets

Forbidden:

```go
const apiKey = "prod_abc123"
```

Required:

```go
type Config struct {
	APIKey string
}

func LoadConfig(env Env) (Config, error) {
	key := env.Get("API_KEY")
	if key == "" {
		return Config{}, errors.New("API_KEY is required")
	}
	return Config{APIKey: key}, nil
}
```

Rules:

- Secrets MUST come from approved secret storage or environment injection mechanism.
- Validate presence, format, and rotation readiness.
- Redact secrets in logs and errors.
- Keep secrets out of test fixtures unless fake and clearly marked.
- Do not commit `.env` files with real secrets.

### 11.2 Secret lifecycle

Rules:

- Use `[]byte` for mutable secret buffers when erasure is required.
- Zero secret buffers after use where meaningful.
- Do not assume Go garbage collection immediately removes secret data.
- Avoid converting secrets to `string` when avoidable because strings are immutable.
- Do not place secrets in context values unless unavoidable and documented.

---

## 12. Secure configuration

Configuration parsing MUST fail fast.

Rules:

- Missing required security config MUST be startup failure.
- Development defaults MUST not silently apply in production.
- Insecure settings MUST require explicit opt-in and environment guard.
- TLS verification MUST not be disabled in production.
- Debug endpoints MUST be protected or disabled.
- pprof endpoints MUST not be exposed publicly.
- Admin endpoints MUST require explicit authentication and authorization.

Forbidden:

```go
if cfg.JWTSecret == "" {
	cfg.JWTSecret = "dev-secret"
}
```

Required:

```go
if cfg.JWTSecret == "" && cfg.Environment != "local" {
	return errors.New("JWT_SECRET is required outside local")
}
```

---

## 13. Build, release, and supply chain

The LLM MUST preserve reproducibility and auditability.

Required gates:

```bash
go fmt ./...
go vet ./...
go test ./...
go test -race ./...
govulncheck ./...
go mod tidy
```

Rules:

- Do not commit generated binaries.
- Do not add unaudited code generation outputs without source and generator version.
- Do not use floating dependency versions in scripts.
- Use `go.sum` integrity checks.
- For production builds, include version, commit, build time, and dirty-state metadata if project uses it.
- Security-sensitive generated code MUST be reviewed as code.
- Tooling dependencies MUST be declared and pinned.

---

## 14. Go-specific security anti-patterns

### 14.1 Package-level mutable state

Forbidden:

```go
var currentUser *User
```

Rules:

- No global mutable request, identity, tenant, permission, or config state.
- Use dependency injection.
- Use request-scoped context only for propagation, not storage of mutable business state.

### 14.2 `panic` for expected security failures

Forbidden:

```go
if !allowed {
	panic("forbidden")
}
```

Required:

```go
if !allowed {
	return ErrForbidden
}
```

### 14.3 Ignoring security-relevant errors

Forbidden:

```go
token, _ := verifier.Verify(raw)
```

Rules:

- Never ignore parse, verify, decode, authorization, signing, encryption, decryption, certificate, or random generation errors.
- Ignored cleanup errors MUST be justified and non-security-critical.

### 14.4 `interface{}` and `map[string]any` as security bypass

Rules:

- Dynamic maps must be validated against schema.
- Type assertions must handle failure.
- Do not authorize based on untyped/dynamic values without canonicalization.

### 14.5 `unsafe` use

Rules:

- `unsafe` is forbidden in security-sensitive code unless there is a documented approved exception.
- No unsafe string/byte conversion for secrets or untrusted input unless reviewed.
- Unsafe code requires tests, fuzzing, race testing, and architecture assumptions.

---

## 15. HTTP security checklist

The LLM MUST check all HTTP handlers against this list:

- [ ] Method is validated.
- [ ] Path variables are validated.
- [ ] Query parameters are parsed and validated.
- [ ] Request body size is limited.
- [ ] Decode rejects malformed input.
- [ ] Unknown field policy is explicit.
- [ ] Authentication is enforced when required.
- [ ] Authorization is enforced server-side.
- [ ] Context cancellation is propagated.
- [ ] Response status codes are stable and safe.
- [ ] Error response does not leak internal details.
- [ ] Security headers are set where applicable.
- [ ] Logs/traces are redacted.
- [ ] Audit event is emitted for sensitive actions.
- [ ] Tests cover invalid input and forbidden cases.

---

## 16. Security testing requirements

Required tests for security-sensitive code:

- valid input,
- invalid syntax,
- invalid semantics,
- unknown fields,
- oversized input,
- empty input,
- malicious path,
- unauthorized actor,
- wrong tenant/scope,
- expired token/deadline,
- duplicate request/idempotency,
- concurrent access/race risk,
- dependency failure,
- cancellation/timeout,
- redaction behavior,
- audit event emission.

Required commands where applicable:

```bash
go test ./...
go test -race ./...
go test -fuzz=Fuzz -run=^$
govulncheck ./...
```

Fuzzing is required for parsers, decoders, canonicalizers, archive handlers, path handlers, and security-sensitive mappers.

---

## 17. Review checklist for LLM output

The LLM MUST self-review using this checklist before finalizing code:

- [ ] Did I identify the trust boundary?
- [ ] Did I bound input size, time, depth, and concurrency?
- [ ] Did I validate input using allowlists where security-sensitive?
- [ ] Did I avoid SQL/shell/path/template injection?
- [ ] Did I avoid leaking secrets/PII/internal errors?
- [ ] Did I enforce authorization server-side?
- [ ] Did I treat workflow transitions as security boundaries?
- [ ] Did I use safe HTTP timeouts and TLS behavior?
- [ ] Did I avoid package-level mutable security state?
- [ ] Did I avoid insecure crypto and random sources?
- [ ] Did I avoid unsafe unless explicitly approved?
- [ ] Did I add tests for denial, invalid input, and limits?
- [ ] Did I preserve auditability?
- [ ] Did I avoid adding unnecessary dependencies?
- [ ] Did I run or request `govulncheck ./...` for dependency/security changes?

---

## 18. LLM refusal and escalation rules

The LLM MUST refuse or escalate when asked to:

- disable TLS verification for production,
- hardcode real secrets,
- bypass authorization,
- hide vulnerability scanner output,
- suppress security errors without handling,
- implement custom crypto without approved design,
- log raw credentials or personal data,
- execute arbitrary shell commands from user input,
- expose pprof/debug/admin endpoints publicly,
- weaken validation because tests are inconvenient.

Escalation response MUST include:

1. the unsafe request,
2. the risk,
3. the safer implementation path,
4. any project decision required.

---

## 19. Minimal secure Go handler template

```go
func (h *Handler) CreateCase(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if r.Method != http.MethodPost {
		writeProblem(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not allowed.")
		return
	}

	actor, err := h.identity.Actor(ctx)
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "unauthenticated", "Authentication is required.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxBodyBytes)
	cmd, err := DecodeCreateCaseCommand(r.Body)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_request", "Request is invalid.")
		return
	}

	result, err := h.service.CreateCase(ctx, actor, cmd)
	if err != nil {
		h.writeServiceError(ctx, w, err)
		return
	}

	writeJSON(ctx, w, http.StatusCreated, mapCreateCaseResponse(result))
}
```

This template is not a framework. It shows the minimum security posture expected from every handler.
