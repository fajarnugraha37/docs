# Strict Coding Standards — Go Validation

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, APIs, CLIs, workers, event processors, regulatory workflow systems  
Baseline: Go 1.24–1.26+, standard library first, framework-agnostic

---

## 1. Purpose

Validation is the boundary between untrusted input and trusted domain behavior.

The LLM MUST treat validation as a correctness, security, and regulatory-defensibility concern. Validation code MUST make invalid states impossible to persist, publish, execute, or silently propagate.

Validation MUST answer four questions:

1. What is the input boundary?
2. Which invariants are syntactic, semantic, domain, authorization, or temporal?
3. What error taxonomy is returned to callers?
4. Which invalid values are rejected, normalized, defaulted, or preserved?

Validation MUST NOT be scattered as incidental `if` statements without ownership.

---

## 2. Source authority

Primary references:

- Go specification: https://go.dev/ref/spec
- Go `encoding/json` package documentation: https://pkg.go.dev/encoding/json
- Go `context` package documentation: https://pkg.go.dev/context
- Go `errors` package documentation: https://pkg.go.dev/errors
- Go `net/http` package documentation: https://pkg.go.dev/net/http
- Go `time` package documentation: https://pkg.go.dev/time
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Go fuzzing documentation: https://go.dev/doc/security/fuzz

---

## 3. Validation taxonomy

The LLM MUST classify validation rules before implementing them.

| Validation kind          | Purpose                                                | Typical owner             | Example                                        |
| ------------------------ | ------------------------------------------------------ | ------------------------- | ---------------------------------------------- |
| Transport validation     | Verify request shape, content type, size, parseability | Handler/adapter           | malformed JSON, unsupported media type         |
| Syntactic validation     | Verify primitive format                                | DTO/input parser          | UUID format, email shape, positive integer     |
| Semantic validation      | Verify field meaning independent of persistence        | application/domain        | start date before end date                     |
| Domain invariant         | Protect business object validity                       | domain constructor/method | case cannot close without final decision       |
| Cross-entity validation  | Verify relationship with other records                 | application service       | referenced license exists and belongs to actor |
| Authorization validation | Verify actor may perform the action                    | policy layer              | officer can update assigned case               |
| Temporal validation      | Verify deadline/effective-date rules                   | domain/policy             | appeal submitted before deadline               |
| Persistence validation   | Enforce final uniqueness/foreign key constraints       | repository/database       | duplicate idempotency key                      |

Rules:

- Transport validation MUST NOT contain business policy.
- Domain invariant MUST NOT depend directly on HTTP, JSON, SQL, or framework types.
- Cross-entity validation MUST happen in application/service layer, not DTO layer.
- Database constraints MUST be treated as final guardrails, not the only validation.

---

## 4. Non-negotiable rules

### 4.1 Validate at every trust boundary

The LLM MUST validate data entering from:

- HTTP request body, path, query, header, cookie,
- CLI args and environment variables,
- message broker payloads,
- database rows when reading legacy/untrusted data,
- files and uploaded documents,
- external API responses,
- cache payloads,
- feature flags and config,
- generated or migrated data.

Forbidden:

```go
var req CreateCaseRequest
_ = json.NewDecoder(r.Body).Decode(&req)
caseID := req.CaseID
```

Preferred:

```go
var req CreateCaseRequest
if err := decodeJSONStrict(r.Body, &req); err != nil {
    return nil, NewValidationError("body", "invalid_json", err)
}

cmd, err := req.ToCommand()
if err != nil {
    return nil, err
}
```

---

### 4.2 Decode strictly at API boundaries

For JSON APIs, the LLM MUST use strict decoding unless compatibility requirements explicitly allow unknown fields.

Required checks:

- request body size limit,
- content type when relevant,
- valid JSON,
- no unknown fields unless explicitly version-tolerant,
- no trailing JSON tokens,
- number precision policy,
- required fields checked explicitly,
- defaulting policy documented.

Preferred helper:

```go
func decodeJSONStrict(r io.Reader, dst any, maxBytes int64) error {
    lr := io.LimitReader(r, maxBytes)
    dec := json.NewDecoder(lr)
    dec.DisallowUnknownFields()

    if err := dec.Decode(dst); err != nil {
        return fmt.Errorf("decode json: %w", err)
    }

    var extra struct{}
    if err := dec.Decode(&extra); err != io.EOF {
        if err == nil {
            return errors.New("decode json: multiple json values")
        }
        return fmt.Errorf("decode json trailing value: %w", err)
    }

    return nil
}
```

Rules:

- Do not rely on zero value alone to mean “field omitted”.
- Use pointer, optional type, or explicit presence tracking when omitted vs zero matters.
- Do not accept unknown fields silently in command-style APIs unless API versioning requires forward compatibility.
- If `encoding/json/v2` is used, gate it through project-level policy because it remains version/feature sensitive across Go releases.

---

### 4.3 Separate parsing, normalization, validation, and authorization

The LLM MUST NOT collapse all input handling into one unstructured function.

Correct sequence:

1. Parse bytes into DTO.
2. Normalize safe representation if policy allows.
3. Validate syntactic/semantic constraints.
4. Map DTO to command/domain input.
5. Authorize actor and operation.
6. Apply domain invariant.
7. Persist or publish.

Forbidden:

```go
func Handle(w http.ResponseWriter, r *http.Request) {
    // parse, validate, authorize, persist, and publish all interleaved
}
```

Preferred shape:

```go
req, err := parseCreateRequest(r)
if err != nil { return err }

cmd, err := req.Command()
if err != nil { return err }

if err := policy.CanCreate(ctx, actor, cmd.TargetID); err != nil {
    return err
}

result, err := svc.CreateCase(ctx, actor, cmd)
if err != nil { return err }
```

---

### 4.4 Domain constructors MUST enforce invariants

Domain objects MUST NOT expose constructors that allow invalid states.

Forbidden:

```go
type Case struct {
    ID     string
    Status string
}

c := Case{ID: "", Status: "whatever"}
```

Preferred:

```go
type CaseID string

type Case struct {
    id     CaseID
    status CaseStatus
}

func NewCase(id CaseID) (Case, error) {
    if err := id.Validate(); err != nil {
        return Case{}, err
    }
    return Case{id: id, status: CaseStatusDraft}, nil
}
```

Rules:

- Use unexported fields for invariant-bearing domain types.
- Expose behavior methods instead of allowing arbitrary mutation.
- Domain methods MUST validate state transition preconditions.
- Repository rehydration MUST have a separate constructor if it must bypass public creation rules.

---

### 4.5 Validate state-machine transitions explicitly

Workflow/status changes MUST be modeled as transitions, not string assignments.

Forbidden:

```go
caseFile.Status = req.Status
```

Preferred:

```go
if err := caseFile.SubmitForReview(now, actor); err != nil {
    return fmt.Errorf("submit case %s: %w", caseFile.ID(), err)
}
```

Rules:

- Every transition MUST define source states, target state, actor rule, timestamp rule, side-effect intent, and rejection reason.
- Invalid transition errors MUST be distinguishable from infrastructure failures.
- The LLM MUST NOT create generic `UpdateStatus(status string)` methods for regulated workflows.

---

### 4.6 Do not validate by regex alone when parsing is available

Regex is allowed for coarse syntactic checks. Use structured parsers for structured values.

Use:

- `time.Parse` / `time.ParseInLocation` for dates,
- `url.ParseRequestURI` or stricter URL policy for URLs,
- `net/netip` for IP address/prefix,
- `mail.ParseAddress` with product-specific constraints for email,
- `strconv` for numeric parsing,
- domain-specific parsers for identifiers.

Forbidden:

```go
if !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`).MatchString(s) {
    return errInvalidDate
}
```

Preferred:

```go
d, err := time.Parse("2006-01-02", s)
if err != nil {
    return Date{}, NewFieldError("start_date", "invalid_date")
}
```

---

### 4.7 Do not hide validation failures behind generic errors

Validation errors MUST be machine-readable enough for UI/API clients and safe enough for logs.

Preferred model:

```go
type FieldError struct {
    Field   string
    Code    string
    Message string
}

type ValidationError struct {
    Fields []FieldError
}

func (e ValidationError) Error() string { return "validation failed" }
```

Rules:

- Do not expose stack traces, SQL details, or internal policy names to external users.
- Do include stable error codes for clients.
- Do preserve internal cause where operationally useful through wrapping or logging.
- Multiple field errors SHOULD be returned together for DTO validation.
- Domain invariant errors MAY fail fast if later checks depend on valid state.

---

### 4.8 Validate numeric ranges before conversion

The LLM MUST avoid narrowing conversions without explicit range checks.

Forbidden:

```go
limit := int32(req.Limit)
```

Preferred:

```go
if req.Limit < 1 || req.Limit > 500 {
    return NewFieldError("limit", "out_of_range")
}
limit := int(req.Limit)
```

Rules:

- All external numeric inputs MUST have min/max constraints.
- Pagination limits MUST have maximum caps.
- Money MUST NOT be represented as `float64`.
- Duration input MUST define unit explicitly.
- Counter/version values MUST define overflow behavior.

---

### 4.9 Validate text as bytes, runes, or domain length explicitly

The LLM MUST NOT use `len(s)` as “character count” unless byte count is intended.

Rules:

- Byte limit is for storage/protocol size.
- Rune limit is for approximate code point count.
- Grapheme/user-visible character count requires Unicode-aware library/policy.
- Trim/normalize policy MUST be explicit.
- Security-sensitive identifiers MUST define allowed character set.
- Free text MUST be size-limited and escaped at output boundary.

Forbidden:

```go
if len(name) > 100 { ... } // unclear: bytes or characters?
```

Preferred:

```go
if utf8.RuneCountInString(name) > 100 {
    return NewFieldError("name", "too_long")
}
```

---

### 4.10 Validate collections for nil/empty/duplicate/order semantics

The LLM MUST define collection constraints.

Required for every slice/map input:

- Is nil allowed?
- Is empty allowed?
- Maximum length?
- Are duplicates allowed?
- Is order meaningful?
- Are elements individually valid?
- Must element relationship be validated?

Preferred:

```go
func ValidateAssigneeIDs(ids []UserID) error {
    if len(ids) == 0 {
        return NewFieldError("assignee_ids", "required")
    }
    if len(ids) > 20 {
        return NewFieldError("assignee_ids", "too_many")
    }

    seen := make(map[UserID]struct{}, len(ids))
    for i, id := range ids {
        if err := id.Validate(); err != nil {
            return NewFieldError(fmt.Sprintf("assignee_ids[%d]", i), "invalid")
        }
        if _, ok := seen[id]; ok {
            return NewFieldError("assignee_ids", "duplicate")
        }
        seen[id] = struct{}{}
    }
    return nil
}
```

---

## 5. Layer-specific validation rules

### 5.1 HTTP handler validation

HTTP handlers MUST:

- limit body size,
- reject unsupported methods/content types,
- parse path/query/header separately,
- distinguish malformed request from valid request that violates domain rule,
- map errors to stable HTTP status codes,
- preserve request cancellation through context,
- avoid logging raw body by default.

Recommended mapping:

| Failure                              |                                             HTTP status |
| ------------------------------------ | ------------------------------------------------------: |
| malformed JSON/body                  |                                                     400 |
| unknown field in strict command API  |                                                     400 |
| syntactic field validation           |                                                     400 |
| authentication required              |                                                     401 |
| authorization denied                 |                                                     403 |
| entity not found                     |                                                     404 |
| state conflict/version conflict      |                                                     409 |
| idempotency conflict                 |                                                     409 |
| semantic validation/domain rejection | 422 if product API uses it; otherwise 400/409 by policy |
| rate limit                           |                                                     429 |
| dependency timeout                   |                                                     504 |

The mapping MUST be project-consistent.

---

### 5.2 CLI/config validation

CLI/config validation MUST fail at startup before processing work.

Rules:

- Environment variables MUST be parsed into typed config.
- Missing required config MUST fail fast.
- Secrets MUST be presence-checked but not logged.
- Durations MUST use explicit units (`time.ParseDuration` or documented config unit).
- URLs, file paths, and ports MUST be validated.
- Config defaults MUST be visible in code or documentation.

Forbidden:

```go
timeout, _ := time.ParseDuration(os.Getenv("TIMEOUT"))
```

Preferred:

```go
timeout, err := time.ParseDuration(cfg.RawTimeout)
if err != nil || timeout <= 0 {
    return Config{}, fmt.Errorf("invalid TIMEOUT")
}
```

---

### 5.3 Message/event validation

Consumers MUST validate messages before applying side effects.

Rules:

- Validate schema version.
- Validate event id / aggregate id / occurred-at timestamp.
- Validate producer identity if available.
- Validate idempotency key.
- Validate monotonic aggregate version where required.
- Reject poison messages to DLQ with safe reason.
- Do not partially apply invalid messages.

Preferred:

```go
if err := event.ValidateEnvelope(); err != nil {
    return consumer.RejectPermanent(err)
}
if err := event.Payload.Validate(); err != nil {
    return consumer.RejectPermanent(err)
}
```

---

### 5.4 Database validation

Repository code MUST not assume database rows are valid when:

- schema evolved,
- data was migrated,
- nullable columns exist,
- legacy services write the same table,
- external ETL writes data,
- raw SQL bypasses domain logic.

Rules:

- Scan into persistence model.
- Convert persistence model into domain through mapper/rehydration constructor.
- If invalid legacy data is encountered, return a typed corruption/invariant error.
- Do not silently coerce invalid database data into default domain values.

---

## 6. Validation and normalization

Normalization MUST be explicit and safe.

Allowed examples:

- trim surrounding whitespace for display names if product requires it,
- lower-case case-insensitive identifiers if canonical representation is lower-case,
- parse and store timestamps in UTC,
- canonicalize enum strings through typed constants.

Forbidden unless documented:

- silently truncating strings,
- changing user-entered legal names,
- stripping internal spaces from identifiers,
- converting invalid values to defaults,
- coercing unknown enum into `Unknown` if it changes behavior,
- timezone conversion without preserving original user intent when date-only semantics matter.

Preferred pattern:

```go
func ParseAgencyCode(raw string) (AgencyCode, error) {
    s := strings.ToUpper(strings.TrimSpace(raw))
    if s == "" {
        return "", NewFieldError("agency_code", "required")
    }
    if !agencyCodePattern.MatchString(s) {
        return "", NewFieldError("agency_code", "invalid")
    }
    return AgencyCode(s), nil
}
```

---

## 7. Optionality and zero value

The LLM MUST distinguish:

- omitted,
- null,
- empty,
- zero,
- defaulted,
- unknown.

Bad:

```go
type Request struct {
    RetryCount int `json:"retry_count"`
}
```

If `0` and omitted mean different things, use explicit optional representation:

```go
type Request struct {
    RetryCount *int `json:"retry_count"`
}
```

or a project-level optional type:

```go
type OptionalInt struct {
    Set   bool
    Value int
}
```

Rules:

- Domain types SHOULD avoid pointer fields unless optionality is real.
- DTOs MAY use pointers to detect JSON presence.
- Persistence models MUST represent database nullability explicitly.
- Do not use `omitempty` as a validation rule.

---

## 8. Validation library policy

The LLM MAY use validation libraries only when the project already standardizes them.

Rules:

- Tags MUST NOT become the only source of domain invariants.
- Cross-field/cross-entity rules MUST be expressed in code.
- Validation tags MUST be tested like normal code.
- Error output MUST be mapped to project-specific error codes.
- Do not introduce a reflection-heavy validation framework for small local validation without justification.

Preferred for core domain:

```go
func (c CreateCaseCommand) Validate() error {
    var fields []FieldError
    // explicit checks
    if len(fields) > 0 {
        return ValidationError{Fields: fields}
    }
    return nil
}
```

---

## 9. Security validation

The LLM MUST apply stricter validation for security-sensitive data.

Required rules:

- File paths MUST prevent traversal; prefer `os.Root` on Go 1.24+ where applicable.
- URLs MUST be checked against allowed scheme/host policy before outbound requests.
- Redirect targets MUST be allowlisted or relative-only.
- Uploaded file names MUST not be trusted as filesystem paths.
- Regex must avoid catastrophic backtracking; Go RE2 helps, but size limits are still required.
- JSON/XML/body inputs MUST have size limits.
- HTML/SQL/shell output MUST use proper escaping/parameterization at output boundary.
- Secrets/tokens/passwords MUST be presence/shape validated but never logged.
- Authorization MUST NOT be inferred from client-provided role/tenant fields.

---

## 10. Testing requirements

Validation code MUST include tests for:

- valid minimal input,
- valid maximal input,
- missing required fields,
- unknown JSON fields,
- malformed JSON,
- trailing JSON tokens,
- null vs omitted vs zero,
- empty string/slice/map,
- duplicate collection values,
- boundary numeric values,
- invalid enum values,
- invalid date/time/timezone,
- Unicode text edge cases,
- authorization/context separation,
- domain transition rejection,
- persistence corruption cases,
- fuzz tests for parsers where input is untrusted.

Table-driven tests are preferred.

Example:

```go
func TestCreateCaseRequestValidate(t *testing.T) {
    tests := []struct {
        name string
        req  CreateCaseRequest
        want string
    }{
        {name: "missing subject", req: CreateCaseRequest{}, want: "subject.required"},
        {name: "too long subject", req: CreateCaseRequest{Subject: strings.Repeat("x", 501)}, want: "subject.too_long"},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := tt.req.Validate()
            if err == nil || !HasValidationCode(err, tt.want) {
                t.Fatalf("Validate() error = %v, want code %s", err, tt.want)
            }
        })
    }
}
```

---

## 11. LLM implementation checklist

Before producing or modifying validation code, the LLM MUST verify:

- [ ] Every external input boundary has size/shape checks.
- [ ] Unknown JSON fields are rejected unless compatibility policy allows them.
- [ ] Required fields are explicit; `omitempty` is not used as validation.
- [ ] Optional vs zero semantics are clear.
- [ ] Domain constructors/methods enforce invariants.
- [ ] Cross-entity and authorization validation are not hidden in DTOs.
- [ ] Date/time validation defines timezone and date-only semantics.
- [ ] Numeric validation defines min, max, overflow, and unit.
- [ ] Text validation defines byte/rune/grapheme policy.
- [ ] Collection validation defines nil/empty/duplicate/order rules.
- [ ] Validation errors are stable, machine-readable, and safe.
- [ ] Tests cover invalid and boundary cases.
- [ ] Security-sensitive inputs have allowlists, not only blocklists.

---

## 12. Forbidden patterns

The LLM MUST NOT introduce:

- validation only in UI/frontend,
- validation only in database constraints,
- silent truncation,
- silent defaulting of invalid input,
- generic `map[string]any` request bodies for typed APIs,
- raw string enum fields in domain objects,
- status mutation without transition method,
- ignored JSON decode errors,
- ignored `Scanner.Err`,
- `panic` for invalid user input,
- regex-only validation for structured values,
- authorization based on user-controlled request fields,
- logging raw invalid payloads containing personal or secret data.

---

## 13. Preferred review comment templates

Use these comments when reviewing LLM-generated code:

- “This validation belongs at the transport boundary; the domain invariant still needs to be enforced in the domain constructor/method.”
- “This code does not distinguish omitted from zero. Please model optionality explicitly.”
- “Unknown JSON fields are silently accepted. For command APIs, use strict decoding unless compatibility policy says otherwise.”
- “This status update bypasses the state machine. Replace assignment with an explicit transition method.”
- “The validation error is not machine-readable. Add a stable field/code pair.”
- “This conversion can overflow. Add range checks before converting.”

---

## 14. Final rule

Validation code is not boilerplate.

The LLM MUST implement validation as a layered correctness contract that protects domain invariants, user experience, operational safety, and regulatory defensibility.
