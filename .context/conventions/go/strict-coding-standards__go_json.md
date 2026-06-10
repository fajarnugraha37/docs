# Strict Coding Standards — Go JSON

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, APIs, CLIs, workers, event processors, persistence adapters, config loaders, regulatory workflow systems  
Baseline: Go 1.24–1.26+, `encoding/json` first, experimental `encoding/json/v2` only behind explicit project decision

---

## 1. Purpose

JSON is a wire contract, not just a serialization format.

The LLM MUST treat JSON code as a compatibility, security, validation, and auditability boundary. JSON handling MUST preserve the difference between omitted, null, zero, empty, invalid, unknown, and defaulted values whenever that difference has domain or API meaning.

JSON implementation MUST answer these questions before code is written:

1. Is this JSON used for public API, internal API, event contract, config, storage, or logging?
2. Are unknown fields allowed, rejected, or preserved?
3. Are optional values represented by omission, explicit `null`, pointer, custom type, or presence wrapper?
4. Are zero values meaningful domain values or absence markers?
5. Is the payload size bounded and decoded as a stream?
6. Is the contract backward/forward compatible?
7. Is output safe for logs, HTML, JavaScript, and audit records?

---

## 2. Source authority

Primary references:

- Go `encoding/json` package documentation: https://pkg.go.dev/encoding/json
- Go 1.24 release notes, `encoding/json` `omitzero`: https://go.dev/doc/go1.24
- Go 1.25 release notes, experimental `encoding/json/v2`: https://go.dev/doc/go1.25
- Go `encoding/json/v2` package documentation: https://pkg.go.dev/encoding/json/v2
- Go `encoding/json/jsontext` package documentation: https://pkg.go.dev/encoding/json/jsontext
- Go `io` package documentation: https://pkg.go.dev/io
- Go `net/http` package documentation: https://pkg.go.dev/net/http
- Go `time` package documentation: https://pkg.go.dev/time
- Go fuzzing documentation: https://go.dev/doc/security/fuzz

If this document conflicts with a project-specific OpenAPI/AsyncAPI/schema contract, the explicit contract wins, but the LLM MUST report the conflict.

---

## 3. JSON boundary taxonomy

The LLM MUST classify the JSON boundary before choosing a struct, tag, decoder option, or mapping rule.

| Boundary                | Primary concern                              | Rule                                                                 |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| Public request body     | strict validation, compatibility, security   | reject malformed and unexpected input unless contract says otherwise |
| Public response body    | stable field names, backward compatibility   | never remove/rename fields without versioning                        |
| Internal service API    | explicit schema and failure semantics        | do not rely on shared domain structs as wire structs                 |
| Event payload           | replayability, schema evolution, idempotency | include version, event id, aggregate id, timestamp, producer         |
| Config file             | fail-fast safety                             | reject unknown fields by default                                     |
| Persistence JSON column | long-term migration                          | store schema version and decode defensively                          |
| Log JSON                | observability and redaction                  | never marshal whole domain object blindly                            |
| Test fixture            | reproducibility                              | keep canonical examples and invalid cases                            |

---

## 4. Non-negotiable rules

### 4.1 Do not expose domain structs directly as JSON contracts

The LLM MUST NOT use domain entities as request/response/event structs unless the type is intentionally designed as a wire contract.

Forbidden:

```go
type Case struct {
	ID          CaseID
	InternalRef string
	Decision    Decision
	Actor       Officer
}

func handle(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(caseService.Get(...)) // leaks domain shape
}
```

Required:

```go
type CaseResponse struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Decision  string `json:"decision,omitempty"`
	UpdatedAt string `json:"updated_at"`
}
```

Domain-to-JSON mapping MUST be explicit and reviewed.

---

### 4.2 Use dedicated DTOs for requests, responses, events, and config

The LLM MUST use separate types for:

- request DTO,
- response DTO,
- event payload,
- persistence JSON document,
- external API payload,
- configuration file.

The LLM MUST NOT reuse one struct across multiple contract directions just because fields overlap.

Example:

```go
type CreateCaseRequest struct {
	LicenseID string `json:"license_id"`
	Reason    string `json:"reason"`
}

type CaseCreatedEventPayload struct {
	SchemaVersion int    `json:"schema_version"`
	CaseID        string `json:"case_id"`
	LicenseID     string `json:"license_id"`
	Reason        string `json:"reason"`
	OccurredAt    string `json:"occurred_at"`
}
```

---

### 4.3 Decode with explicit size limit at external boundaries

The LLM MUST bound JSON body size before decoding external input.

Required for HTTP:

```go
const maxBodyBytes = 1 << 20 // 1 MiB; choose per endpoint

r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
```

For non-HTTP streams, use `io.LimitReader` or an equivalent bounded reader.

Forbidden:

```go
var req CreateCaseRequest
_ = json.NewDecoder(r.Body).Decode(&req) // unbounded body
```

---

### 4.4 Reject unknown fields unless compatibility requires preservation

For request/config decode, the LLM MUST use `Decoder.DisallowUnknownFields()` by default.

Unknown fields MAY be accepted only when the contract explicitly supports forward compatibility. If accepted, the behavior MUST be documented:

- ignored,
- preserved in raw extension map,
- validated by schema version,
- rejected in strict mode.

Required strict decode helper:

```go
func DecodeStrictJSON[T any](r io.Reader, maxBytes int64) (T, error) {
	var zero T
	dec := json.NewDecoder(io.LimitReader(r, maxBytes))
	dec.DisallowUnknownFields()

	var out T
	if err := dec.Decode(&out); err != nil {
		return zero, fmt.Errorf("decode json: %w", err)
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return zero, fmt.Errorf("decode json: multiple JSON values are not allowed")
	}
	return out, nil
}
```

---

### 4.5 Reject trailing JSON values

The LLM MUST reject request bodies containing multiple JSON values unless NDJSON/streaming JSON is explicitly required.

Forbidden:

```json
{"name":"a"}{"role":"admin"}
```

A single successful `Decode` is not enough. The decoder MUST check for EOF after the first value.

---

### 4.6 Do not silently ignore decode errors

The LLM MUST classify JSON decode errors into caller-safe error categories:

- malformed JSON,
- unknown field,
- type mismatch,
- empty body,
- too large,
- multiple JSON values,
- unsupported media type,
- semantic validation error.

The LLM MUST NOT return raw internal error text to public clients if it leaks implementation detail.

---

## 5. Struct tag rules

### 5.1 All wire fields MUST have explicit JSON tags

Every exported field in a JSON DTO MUST have a `json` tag.

Required:

```go
type CreateUserRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}
```

Forbidden:

```go
type CreateUserRequest struct {
	Email string
	Name  string
}
```

Rationale: default Go field names are not stable API design.

---

### 5.2 Use stable snake_case or project-approved naming

JSON field naming MUST be consistent within the project.

Preferred default:

```go
type CaseResponse struct {
	CaseID    string `json:"case_id"`
	CreatedAt string `json:"created_at"`
}
```

The LLM MUST NOT mix `caseId`, `case_id`, `CaseID`, and `case-id` in the same service unless integrating with an external contract.

---

### 5.3 Use `-` for internal fields

Fields that must never cross the JSON boundary MUST be tagged explicitly:

```go
type CaseResponse struct {
	ID             string `json:"id"`
	InternalPolicy string `json:"-"`
}
```

The LLM MUST NOT rely on unexported fields alone when the struct is also used internally and externally.

---

### 5.4 Treat `omitempty` as an output contract, not a convenience

The LLM MUST NOT add `omitempty` just to reduce payload size.

`omitempty` changes the wire contract. It collapses some values into absence and can break clients that distinguish empty from missing.

Allowed:

```go
type SearchResponse struct {
	NextCursor string `json:"next_cursor,omitempty"`
}
```

Forbidden when empty is meaningful:

```go
type ReviewResponse struct {
	Comments []Comment `json:"comments,omitempty"` // client expects [] when none
}
```

Prefer:

```go
type ReviewResponse struct {
	Comments []Comment `json:"comments"`
}
```

---

### 5.5 Use `omitzero` only with explicit zero-value semantics

From Go 1.24+, `omitzero` may be used when the zero value must be omitted according to Go zero-value semantics or a type's `IsZero() bool` method.

Allowed:

```go
type DecisionResponse struct {
	ApprovedAt time.Time `json:"approved_at,omitzero"`
}
```

Rules:

- The LLM MUST document why zero means absence.
- The LLM MUST NOT use `omitzero` for fields where zero is a valid business value.
- If both `omitempty` and `omitzero` are used, tests MUST prove the exact omission behavior.

Forbidden:

```go
type Penalty struct {
	AmountCents int64 `json:"amount_cents,omitzero"` // zero may mean waived/none/unknown
}
```

---

## 6. Optionality and presence semantics

### 6.1 Distinguish missing, null, zero, and empty

The LLM MUST not assume these are equivalent:

| JSON state   | Example         | Meaning                   |
| ------------ | --------------- | ------------------------- |
| Missing      | `{}`            | field not sent            |
| Null         | `{"name":null}` | explicit null             |
| Zero         | `{"count":0}`   | numeric zero              |
| Empty string | `{"name":""}`   | provided empty string     |
| Empty array  | `{"items":[]}`  | provided empty collection |

For PATCH/update APIs, the LLM MUST preserve presence.

Bad:

```go
type PatchUserRequest struct {
	Name string `json:"name"`
}
```

Better:

```go
type PatchUserRequest struct {
	Name *string `json:"name"`
}
```

Best when null has separate meaning:

```go
type OptionalString struct {
	Set   bool
	Null  bool
	Value string
}
```

---

### 6.2 Pointer fields are allowed only for optionality or large immutable values

The LLM MUST NOT use pointer fields in JSON DTOs by default.

Allowed:

```go
type PatchRequest struct {
	DisplayName *string `json:"display_name"`
}
```

Forbidden:

```go
type CreateRequest struct {
	Name *string `json:"name"` // required field modeled as pointer
}
```

Required create/request validation:

```go
if strings.TrimSpace(req.Name) == "" {
	return ValidationError{Field: "name", Code: "required"}
}
```

---

### 6.3 Do not rely on `map[string]any` for typed contracts

The LLM MUST NOT decode business payloads into `map[string]any` unless implementing:

- generic pass-through,
- schema migration tool,
- dynamic extension field,
- logging sanitizer,
- JSON patch/merge patch,
- unknown field preservation.

If `map[string]any` is used, the LLM MUST define validation and type assertions explicitly.

Forbidden:

```go
var payload map[string]any
json.NewDecoder(r.Body).Decode(&payload)
amount := payload["amount"].(float64)
```

---

## 7. Numeric rules

### 7.1 Do not decode money or IDs through `float64`

By default, numbers decoded into `interface{}` become `float64` in `encoding/json`. The LLM MUST NOT use that path for IDs, money, counters, versions, or timestamps.

Required alternatives:

- strongly typed struct fields,
- `Decoder.UseNumber()` when generic decoding is unavoidable,
- strings for very large external IDs if the contract requires it,
- integer minor units for money.

Example:

```go
dec := json.NewDecoder(r)
dec.UseNumber()
```

---

### 7.2 Validate integer range after decode

The LLM MUST validate domain range after JSON decode.

Example:

```go
if req.PageSize < 1 || req.PageSize > 100 {
	return ValidationError{Field: "page_size", Code: "out_of_range"}
}
```

JSON type correctness is not domain correctness.

---

## 8. Time and date JSON rules

### 8.1 Use RFC3339/RFC3339Nano for instants

The LLM MUST encode instants as RFC3339-compatible strings unless a project contract says otherwise.

Required:

```go
type EventPayload struct {
	OccurredAt time.Time `json:"occurred_at"`
}
```

Rules:

- Store and transmit instants in UTC unless contract requires location preservation.
- Use date-only string types for calendar dates.
- Do not use Unix milliseconds unless mandated by external API.
- Do not use local timezone implicitly.

---

### 8.2 Date-only values MUST NOT be `time.Time` without a policy wrapper

Date-only values are not instants.

Required:

```go
type LocalDate struct {
	year  int
	month time.Month
	day   int
}
```

or a project-approved date wrapper with explicit JSON marshal/unmarshal.

Forbidden:

```go
type License struct {
	ExpiryDate time.Time `json:"expiry_date"` // ambiguous if date-only
}
```

---

## 9. Custom marshal/unmarshal rules

### 9.1 Custom JSON methods MUST be small and tested

Custom `MarshalJSON` and `UnmarshalJSON` are allowed only for:

- value objects,
- date-only wrappers,
- enum-like types,
- optional/presence types,
- external contract compatibility,
- redaction wrappers.

They MUST NOT perform database lookup, service calls, logging side effects, authorization, or complex business workflow.

---

### 9.2 Custom unmarshal MUST validate representation, not domain policy

Allowed:

```go
func (s *Status) UnmarshalJSON(b []byte) error {
	var raw string
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	st, ok := parseStatus(raw)
	if !ok {
		return fmt.Errorf("invalid status %q", raw)
	}
	*s = st
	return nil
}
```

Forbidden:

```go
func (r *CreateCaseRequest) UnmarshalJSON(b []byte) error {
	// calls repository, checks assignment, publishes event
}
```

---

### 9.3 Avoid recursive MarshalJSON/UnmarshalJSON bugs

The LLM MUST use alias types to avoid recursion.

Required:

```go
func (r Response) MarshalJSON() ([]byte, error) {
	type alias Response
	return json.Marshal(struct {
		alias
		Kind string `json:"kind"`
	}{
		alias: alias(r),
		Kind:  "case_response",
	})
}
```

---

## 10. Streaming and large JSON

### 10.1 Do not read large JSON fully into memory

For large arrays, NDJSON, exports, imports, and event replay, the LLM MUST use streaming decode/encode.

Allowed:

```go
dec := json.NewDecoder(r)

tok, err := dec.Token()
if err != nil {
	return err
}
if delim, ok := tok.(json.Delim); !ok || delim != '[' {
	return fmt.Errorf("expected array")
}

for dec.More() {
	var item ImportItem
	if err := dec.Decode(&item); err != nil {
		return err
	}
	if err := process(item); err != nil {
		return err
	}
}
```

Forbidden:

```go
var items []ImportItem
json.NewDecoder(r).Decode(&items) // unbounded array
```

---

### 10.2 NDJSON MUST be explicitly declared

If processing newline-delimited JSON, the LLM MUST not use regular single-document decode helpers.

Rules:

- Define max line size.
- Validate each record independently.
- Include record number in error context.
- Continue or stop on error according to import policy.
- Do not use `bufio.Scanner` for unbounded lines without increasing and bounding buffer.

---

## 11. Encoding response rules

### 11.1 Set headers before encoding

For HTTP JSON responses, the LLM MUST set status and headers before writing body.

Required:

```go
w.Header().Set("Content-Type", "application/json; charset=utf-8")
w.WriteHeader(http.StatusCreated)
if err := json.NewEncoder(w).Encode(resp); err != nil {
	logger.ErrorContext(r.Context(), "encode response failed", "err", err)
}
```

The LLM MUST NOT write partial success response and then attempt to change status code.

---

### 11.2 Do not encode raw errors as JSON responses

Forbidden:

```go
json.NewEncoder(w).Encode(err)
```

Required:

```go
type ErrorResponse struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	RequestID string            `json:"request_id,omitempty"`
	Fields    []FieldError      `json:"fields,omitempty"`
	Meta      map[string]string `json:"meta,omitempty"`
}
```

---

### 11.3 Preserve empty arrays when clients expect arrays

The LLM MUST initialize slices when JSON response must contain `[]` instead of `null`.

Required:

```go
resp.Items = make([]ItemResponse, 0)
```

or normalize in mapper.

The LLM MUST NOT rely on nil slice output unless `null` is part of the contract.

---

## 12. Security rules

### 12.1 Never log full raw JSON from untrusted sources by default

Raw JSON may contain credentials, tokens, personal data, regulated data, or malicious payloads.

Allowed only if:

- size is bounded,
- data is redacted,
- log level and retention are approved,
- legal/audit policy allows it,
- payload is not a secret-bearing request.

---

### 12.2 Escape policy MUST be explicit for HTML/JavaScript contexts

`encoding/json` escapes certain characters to make JSON safer for embedding in HTML contexts. The LLM MUST NOT disable escaping unless the output context is known and tested.

If `Encoder.SetEscapeHTML(false)` is used, code review MUST confirm the JSON will not be embedded into HTML/script context.

---

### 12.3 Reject or sanitize untrusted JSON used in templates, SQL, shell, path, or logs

JSON decode does not make data safe.

The LLM MUST still apply context-specific escaping/validation before using values in:

- HTML,
- SQL,
- shell command,
- file path,
- URL,
- XML,
- logs,
- regex,
- message headers.

---

## 13. Event JSON rules

Event JSON MUST be replayable and versioned.

Required event envelope:

```go
type EventEnvelope[T any] struct {
	EventID       string `json:"event_id"`
	EventType     string `json:"event_type"`
	SchemaVersion int    `json:"schema_version"`
	AggregateType string `json:"aggregate_type"`
	AggregateID   string `json:"aggregate_id"`
	OccurredAt    string `json:"occurred_at"`
	Producer      string `json:"producer"`
	Payload       T      `json:"payload"`
}
```

Rules:

- Never remove existing fields from published event contracts without versioning.
- Additive fields MUST be optional or have documented defaults.
- Consumers MUST tolerate unknown fields only if schema evolution policy requires it.
- Event time MUST be an instant, not local wall-clock string.
- Idempotency keys MUST not be derived from lossy JSON representation.

---

## 14. Config JSON rules

Config JSON decoding MUST be strict.

Rules:

- Unknown fields MUST be rejected.
- Defaults MUST be applied explicitly after decode.
- Required fields MUST be validated.
- Duration fields MUST use a documented format.
- Secrets MUST not be printed in validation errors.
- File path fields MUST be normalized and validated.

Forbidden:

```go
json.Unmarshal(data, &cfg) // no strictness, no unknown-field check
```

---

## 15. Experimental `encoding/json/v2` rules

`encoding/json/v2` and `encoding/json/jsontext` MUST NOT be introduced casually.

Allowed only when all conditions are true:

1. The project explicitly enables `GOEXPERIMENT=jsonv2` or targets a Go version where it is stable.
2. The package API and behavioral differences have been reviewed.
3. Compatibility tests compare old and new behavior on representative payloads.
4. Rollback is possible.
5. Wire contract changes are documented.

The LLM MUST NOT migrate from `encoding/json` to `encoding/json/v2` for performance claims without benchmark evidence and behavior-difference tests.

---

## 16. Testing requirements

JSON code MUST have tests for:

- valid minimal payload,
- valid full payload,
- missing required field,
- explicit null,
- zero value,
- empty string/array/object,
- unknown field,
- wrong type,
- malformed JSON,
- trailing JSON value,
- payload too large,
- time/date parsing,
- numeric overflow/range,
- custom marshal/unmarshal,
- backward-compatible old payload,
- forward-compatible new payload if contract allows it,
- redaction behavior,
- event replay.

For public APIs and event contracts, golden tests SHOULD be used.

---

## 17. Fuzzing requirements

The LLM SHOULD add fuzz tests for custom JSON decoders, parsers, optional wrappers, date wrappers, enum decoders, and migration decoders.

Minimum fuzz invariant:

- no panic,
- bounded memory,
- invalid data rejected,
- valid round-trip preserved where applicable,
- errors do not leak secrets.

---

## 18. Anti-patterns

The LLM MUST NOT introduce these patterns:

- decoding request body without size limit,
- using `map[string]any` for stable business contracts,
- swallowing JSON decode errors,
- accepting unknown fields in command/config payloads by accident,
- using domain structs as JSON DTOs,
- using `omitempty` on fields where empty has meaning,
- using pointer fields everywhere to avoid validation,
- encoding raw `error` values to clients,
- using float64 for money, version, ID, or exact counters,
- logging full raw payloads by default,
- migration to `json/v2` without explicit project decision,
- custom `UnmarshalJSON` with database/network side effects,
- relying on map iteration order for canonical JSON.

---

## 19. LLM implementation checklist

Before submitting JSON-related code, the LLM MUST verify:

- [ ] Boundary type is classified: request, response, event, config, persistence, external API, log.
- [ ] DTO is separate from domain/persistence unless explicitly justified.
- [ ] External decode has a size limit.
- [ ] Unknown-field policy is explicit.
- [ ] Trailing JSON values are rejected unless streaming/NDJSON.
- [ ] Optional/null/zero/empty semantics are tested.
- [ ] `omitempty`/`omitzero` usage is contractually justified.
- [ ] Numbers avoid lossy `float64` paths.
- [ ] Time/date encoding is explicit.
- [ ] Errors are mapped to safe API errors.
- [ ] Logs are redacted and bounded.
- [ ] Large payloads are streamed.
- [ ] Event payloads are versioned.
- [ ] Config decoding is strict.
- [ ] Custom marshal/unmarshal has unit and fuzz tests where appropriate.
- [ ] Backward/forward compatibility is tested for public contracts.
