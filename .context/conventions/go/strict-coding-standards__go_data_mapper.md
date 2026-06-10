# Strict Coding Standards — Go Data Mapper

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, APIs, repositories, event processors, ETL jobs, workflow systems  
Baseline: Go 1.24–1.26+, standard library first, framework-agnostic

---

## 1. Purpose

Data mapping converts data between representations without leaking concerns across boundaries.

The LLM MUST treat data mappers as correctness boundaries, not mechanical field copying. A mapper protects domain invariants, persistence contracts, transport compatibility, and event/schema evolution.

The mapper MUST make explicit:

- source representation,
- target representation,
- ownership and aliasing,
- optional/null/default semantics,
- validation or invariant handoff,
- lossy vs lossless conversion,
- error behavior,
- version compatibility.

---

## 2. Source authority

Primary references:

- Go specification: https://go.dev/ref/spec
- Go `encoding/json` package documentation: https://pkg.go.dev/encoding/json
- Go `database/sql` package documentation: https://pkg.go.dev/database/sql
- Go `database/sql/driver` package documentation: https://pkg.go.dev/database/sql/driver
- Go `time` package documentation: https://pkg.go.dev/time
- Go `errors` package documentation: https://pkg.go.dev/errors
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Effective Go: https://go.dev/doc/effective_go

---

## 3. Representation boundaries

The LLM MUST keep these representations distinct unless a project explicitly chooses a simpler architecture.

| Representation      | Purpose                             | Must not contain                                    |
| ------------------- | ----------------------------------- | --------------------------------------------------- |
| Transport DTO       | API/message shape and compatibility | domain behavior, SQL tags, DB null hacks            |
| Command/query input | Application use-case input          | HTTP framework types, JSON tags if avoidable        |
| Domain model        | Invariants and behavior             | persistence tags, JSON compatibility compromises    |
| Persistence model   | Database row/document shape         | HTTP status, UI labels, domain transition shortcuts |
| Event model         | Published contract                  | internal DB-only fields, unstable domain internals  |
| View/read model     | Query/UI projection                 | command-only validation behavior                    |

Rules:

- Do not reuse the same struct for HTTP, domain, database, and event payloads in non-trivial systems.
- If a struct crosses more than one boundary, justify it with simplicity and low-risk scope.
- Domain types MUST not depend on database/sql, json tags, HTTP framework types, or broker metadata.

---

## 4. Non-negotiable rules

### 4.1 Mappers MUST be explicit functions or methods

Forbidden:

```go
func Create(req CreateCaseRequest) Case {
    return Case(req)
}
```

Preferred:

```go
func (r CreateCaseRequest) ToCommand() (CreateCaseCommand, error) {
    subject, err := ParseSubject(r.Subject)
    if err != nil {
        return CreateCaseCommand{}, err
    }

    return CreateCaseCommand{
        Subject: subject,
        ActorID: ParseActorID(r.ActorID),
    }, nil
}
```

Rules:

- Mapper names MUST state direction: `ToCommand`, `FromDomain`, `ToRow`, `FromRow`, `ToEvent`.
- Mapper functions MUST return error if conversion can fail.
- Mapper errors MUST identify the source field or invariant failure.
- Do not hide mapping errors through zero values.

---

### 4.2 Domain construction MUST go through domain constructors

Mappers MUST not bypass domain invariants.

Forbidden:

```go
return domain.Case{
    ID: row.ID,
    Status: domain.CaseStatus(row.Status),
}, nil
```

Preferred:

```go
return domain.RehydrateCase(domain.CaseSnapshot{
    ID:        domain.CaseID(row.ID),
    Status:    domain.CaseStatus(row.Status),
    Version:   row.Version,
    CreatedAt: row.CreatedAt,
})
```

Rules:

- Public creation path and persistence rehydration path MAY differ.
- Rehydration MUST still validate stored invariants.
- If legacy invalid data exists, mapper MUST return a typed corruption/invariant error.
- Do not silently repair corrupt persistence data unless a migration/repair policy exists.

---

### 4.3 Mapping MUST define lossiness

Every mapper MUST be classified as lossless or lossy.

Examples:

| Mapping                   | Usually                              |
| ------------------------- | ------------------------------------ |
| API request DTO → command | lossy; ignores transport metadata    |
| domain → persistence row  | mostly lossless for persisted fields |
| persistence row → domain  | should be lossless or fail           |
| domain → public response  | intentionally lossy; hides internals |
| domain → event            | contract-dependent; may be lossy     |
| event → projection        | lossy by projection design           |

Rules:

- Lossy mapping MUST be intentional.
- Do not drop fields silently during write/publish mapping.
- Response mappers MUST not expose secrets, internal comments, security metadata, or unapproved audit fields.

---

### 4.4 Nil, null, empty, zero, and omitted semantics MUST be preserved

The LLM MUST map optionality explicitly.

Forbidden:

```go
Name: row.Name.String, // ignores Valid
```

Preferred:

```go
var name *domain.DisplayName
if row.Name.Valid {
    parsed, err := domain.ParseDisplayName(row.Name.String)
    if err != nil {
        return domain.Profile{}, fmt.Errorf("map profile.name: %w", err)
    }
    name = &parsed
}
```

Rules:

- SQL nullable fields MUST not be mapped as zero values without checking validity.
- JSON omitted/null/empty must be mapped according to API contract.
- Empty slice vs nil slice must be deliberate at response boundary.
- For partial updates, absent fields MUST not overwrite existing values.

---

### 4.5 Do not use reflection-based auto-mapping by default

The LLM MUST NOT introduce reflection-based mappers merely to reduce code.

Forbidden by default:

```go
automapper.Map(&dst, src)
```

Reasons:

- hides dropped fields,
- hides failed conversions,
- weakens compile-time safety,
- breaks during refactors,
- mishandles optionality,
- often ignores domain constructors,
- makes security review harder.

Reflection-based mapping MAY be used only for:

- narrow internal tooling,
- generated code validation,
- test fixtures,
- metadata extraction,
- legacy migration with strong tests.

If used, it MUST have tests proving all fields and failure cases.

---

### 4.6 Prefer hand-written or generated mappers over magical mappers

Preferred order:

1. Hand-written mapper for domain-critical paths.
2. Generated mapper with explicit config and compile/test gate.
3. Reflection mapper only when justified.

Rules for generated mappers:

- Generated files MUST be reproducible.
- Generation command MUST be documented.
- Generated code MUST be checked by tests.
- Custom conversion functions MUST be explicit.
- Domain constructors MUST still be used.

---

## 5. DTO to command mapping

DTO-to-command mapping MUST:

- validate syntactic fields,
- normalize only according to policy,
- convert primitive strings into domain value types,
- preserve omitted/null semantics for partial updates,
- avoid business/persistence side effects,
- return validation errors, not persistence errors.

Example:

```go
type CreateCaseRequest struct {
    Subject     string `json:"subject"`
    Description string `json:"description"`
    Priority    string `json:"priority"`
}

func (r CreateCaseRequest) ToCommand(actor ActorID) (CreateCaseCommand, error) {
    subject, err := ParseSubject(r.Subject)
    if err != nil {
        return CreateCaseCommand{}, err
    }

    priority, err := ParsePriority(r.Priority)
    if err != nil {
        return CreateCaseCommand{}, err
    }

    return CreateCaseCommand{
        ActorID:     actor,
        Subject:     subject,
        Description: ParseDescription(r.Description),
        Priority:    priority,
    }, nil
}
```

Rules:

- Actor/tenant MUST come from authenticated context/session, not client DTO field unless explicitly delegated.
- Do not pass raw DTO to domain service if mapping is non-trivial.
- Do not let DTO tags dictate domain field names.

---

## 6. Domain to response mapping

Response mappers MUST be presentation-contract aware.

Rules:

- Expose only fields approved by API contract.
- Do not leak internal IDs unless part of contract.
- Do not expose authorization-sensitive state.
- Format timestamps consistently, preferably RFC3339/RFC3339Nano by policy.
- Preserve date-only semantics where applicable.
- Convert enums to stable external strings.
- Avoid pointer-heavy response structs unless null is contractually meaningful.

Example:

```go
func NewCaseResponse(c domain.Case) CaseResponse {
    return CaseResponse{
        ID:        c.ID().String(),
        Status:    string(c.Status()),
        Subject:   c.Subject().String(),
        CreatedAt: c.CreatedAt().UTC().Format(time.RFC3339Nano),
    }
}
```

---

## 7. Domain to persistence mapping

Persistence mapping MUST reflect database schema intentionally.

Rules:

- Use persistence row structs for database shape.
- Do not put SQL-specific nullability into domain model.
- Map domain value objects to primitive DB values at the repository boundary.
- Use UTC for instants unless schema explicitly stores local time/date-only values.
- Map version/revision fields explicitly for optimistic concurrency.
- Map audit fields intentionally (`created_by`, `updated_by`, etc.).
- Do not persist derived fields unless read model/projection policy requires it.

Example:

```go
func CaseToRow(c domain.Case) CaseRow {
    return CaseRow{
        ID:        string(c.ID()),
        Status:    string(c.Status()),
        Subject:   c.Subject().String(),
        Version:   c.Version(),
        CreatedAt: c.CreatedAt().UTC(),
        UpdatedAt: c.UpdatedAt().UTC(),
    }
}
```

---

## 8. Persistence to domain mapping

Persistence-to-domain mapping MUST treat database data as untrusted when needed.

Rules:

- Check `sql.Null*` validity.
- Convert enum strings through parser/validator.
- Validate timestamp assumptions.
- Validate version values.
- Validate foreign-key-like embedded references if needed.
- Return typed corruption error for impossible row state.

Example:

```go
func CaseFromRow(row CaseRow) (domain.Case, error) {
    snap := domain.CaseSnapshot{
        ID:        domain.CaseID(row.ID),
        Status:    domain.CaseStatus(row.Status),
        Subject:   domain.Subject(row.Subject),
        Version:   row.Version,
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt,
    }

    c, err := domain.RehydrateCase(snap)
    if err != nil {
        return domain.Case{}, fmt.Errorf("map case row id=%s: %w", row.ID, err)
    }
    return c, nil
}
```

---

## 9. Partial update mapping

Partial update mapping MUST preserve presence.

Forbidden:

```go
type UpdateRequest struct {
    Subject string `json:"subject,omitempty"`
}
// Cannot distinguish omitted from empty string.
```

Preferred:

```go
type UpdateCaseRequest struct {
    Subject *string `json:"subject"`
}

func (r UpdateCaseRequest) ToPatch() (CasePatch, error) {
    var patch CasePatch
    if r.Subject != nil {
        subject, err := ParseSubject(*r.Subject)
        if err != nil {
            return CasePatch{}, err
        }
        patch.Subject = optional.Some(subject)
    }
    return patch, nil
}
```

Rules:

- Do not use `omitempty` to infer patch semantics.
- Patch commands MUST represent set/unset/no-change explicitly.
- Null must have a defined meaning: clear field, reject, or no-op.
- Empty string must not accidentally clear a field unless policy allows it.

---

## 10. Event mapping

Domain-to-event mapping MUST preserve event contract and idempotency semantics.

Rules:

- Event schema version MUST be explicit.
- Event id, aggregate id, aggregate type, aggregate version, occurred-at, and causation/correlation id SHOULD be mapped consistently.
- Event payload MUST contain only contract-approved fields.
- Do not publish database row structs as events.
- Do not publish internal domain structs directly if they may evolve independently.
- Mapping MUST be deterministic for idempotency-sensitive systems.

Example:

```go
func CaseSubmittedEventFromDomain(c domain.Case, meta EventMeta) CaseSubmittedEvent {
    return CaseSubmittedEvent{
        EventID:          meta.EventID,
        AggregateID:      c.ID().String(),
        AggregateVersion: c.Version(),
        OccurredAt:       meta.OccurredAt.UTC(),
        Payload: CaseSubmittedPayload{
            Status: string(c.Status()),
        },
    }
}
```

---

## 11. External API mapping

External API models MUST be isolated behind anti-corruption mappers.

Rules:

- Do not leak vendor DTOs into domain/application layers.
- Map vendor error/status codes into project-specific typed errors.
- Normalize timezones, enum names, and identifier formats explicitly.
- Preserve raw vendor payload only in controlled audit/debug storage if allowed.
- Do not trust external API response just because it came from a partner system.

Preferred:

```go
func mapVendorStatus(s string) (domain.CheckStatus, error) {
    switch s {
    case "APPROVED":
        return domain.CheckApproved, nil
    case "REJECTED":
        return domain.CheckRejected, nil
    default:
        return "", fmt.Errorf("unknown vendor status %q", s)
    }
}
```

---

## 12. Time/date mapping

Rules:

- Instants MUST be normalized to UTC at persistence/event boundaries unless policy says otherwise.
- Date-only values MUST not be converted through midnight UTC unless that is the actual semantics.
- Local business deadlines MUST carry location/timezone explicitly.
- `time.Time` monotonic component is not serialized; do not rely on it across mapping boundaries.
- Use `time.RFC3339` or `time.RFC3339Nano` for API instants by policy.

---

## 13. Number and money mapping

Rules:

- Money MUST map through minor units or decimal type, not `float64`.
- Numeric narrowing MUST range-check before conversion.
- JSON numbers that may exceed safe client precision MUST be strings or documented numeric contract.
- Database decimal/numeric columns MUST have explicit scale/rounding policy.
- Pagination sizes MUST be capped during DTO-to-command mapping.

---

## 14. Text mapping

Rules:

- Do not truncate text silently.
- Preserve Unicode exactly unless normalization policy exists.
- Escape at output boundary, not inside domain values.
- Do not HTML-escape JSON fields manually before JSON encoding.
- Do not log raw personal data during mapping errors.
- Define byte/rune/grapheme policy for length conversion.

---

## 15. Byte/buffer mapping

Rules:

- Copy byte slices when ownership crosses a boundary.
- Do not retain caller-owned buffers without documenting ownership.
- Do not convert `[]byte` to string or string to `[]byte` in hot paths without considering allocation.
- Do not use unsafe zero-copy conversions in business code.
- Secret bytes MUST be cleared where policy and lifecycle allow.

Preferred:

```go
func ClonePayload(b []byte) []byte {
    if b == nil {
        return nil
    }
    return append([]byte(nil), b...)
}
```

---

## 16. Mapping and errors

Mapper errors MUST be contextual but safe.

Preferred:

```go
priority, err := domain.ParsePriority(row.Priority)
if err != nil {
    return domain.Case{}, fmt.Errorf("map case.priority from row id=%s: %w", row.ID, err)
}
```

Rules:

- Include stable entity id when useful.
- Do not include raw secrets or full payloads.
- Wrap lower-level errors with `%w` when callers need `errors.Is`/`errors.As`.
- Classify errors as validation, corruption, compatibility, or infrastructure where relevant.

---

## 17. Mapper placement

Recommended package placement:

```text
internal/caseapi/
  request.go       // transport DTO
  response.go      // transport response DTO
  mapper.go        // DTO <-> command/response mapping

internal/caseapp/
  command.go
  service.go

internal/casedomain/
  case.go
  status.go

internal/caserepo/
  row.go           // persistence model
  mapper.go        // row <-> domain mapping
  repository.go

internal/caseevent/
  event.go
  mapper.go        // domain -> event mapping
```

Rules:

- Mapper should live near the boundary it protects.
- Domain package should not import adapter/repository/API packages.
- Avoid cyclic dependencies by mapping through command/snapshot types.

---

## 18. Testing requirements

Mapper tests MUST cover:

- successful minimal mapping,
- all fields mapped intentionally,
- unknown enum/status,
- null/omitted/empty/zero semantics,
- invalid persistence row,
- invalid DTO field,
- partial update no-change vs clear vs set,
- time zone/date-only mapping,
- numeric overflow/precision,
- byte slice ownership,
- event version compatibility,
- response redaction,
- round-trip where round-trip is expected.

Preferred test pattern:

```go
func TestCaseFromRowRejectsInvalidStatus(t *testing.T) {
    row := CaseRow{ID: "case-1", Status: "BROKEN", Version: 1}

    _, err := CaseFromRow(row)
    if err == nil {
        t.Fatal("CaseFromRow() error = nil, want error")
    }
    if !errors.Is(err, domain.ErrInvalidStatus) {
        t.Fatalf("CaseFromRow() error = %v, want ErrInvalidStatus", err)
    }
}
```

---

## 19. Review checklist

Before approving mapper code, the LLM/reviewer MUST verify:

- [ ] Source and target representation are clear.
- [ ] Mapper direction is explicit in name.
- [ ] Domain constructors/rehydration functions are used.
- [ ] Optional/null/zero semantics are preserved.
- [ ] Numeric and time conversions are safe.
- [ ] No unauthorized fields are exposed in responses/events.
- [ ] Persistence nullability does not leak into domain.
- [ ] Byte slices are copied when ownership crosses boundary.
- [ ] Mapping errors are contextual and safe.
- [ ] Reflection automapping is not used without justification.
- [ ] Tests cover success, failure, boundary, and compatibility cases.

---

## 20. Forbidden patterns

The LLM MUST NOT introduce:

- one struct reused for HTTP, domain, DB, and event in complex systems,
- raw database row returned as API response,
- raw API request passed into domain service,
- domain model with JSON/SQL/framework tags by default,
- direct struct casting between layers,
- reflection automapper without strong justification,
- ignored null validity,
- silent enum fallback,
- silent field dropping during persistence/event mapping,
- mapping that bypasses domain transition methods,
- mapping that leaks secrets or internal audit notes,
- partial update that cannot distinguish omitted from zero.

---

## 21. Preferred review comment templates

- “This mapper bypasses the domain constructor; route through the domain creation/rehydration function.”
- “This DTO is being reused as persistence model. Split API contract from database contract.”
- “This mapping loses null/omitted semantics. Add explicit optional representation.”
- “This response exposes an internal field. Map only contract-approved fields.”
- “This enum fallback hides incompatible data. Return a mapping error instead.”
- “This reflection mapper hides field coverage. Use explicit mapper or generated mapper with tests.”

---

## 22. Final rule

Data mapping is architecture glue with correctness obligations.

The LLM MUST make all boundary translations explicit, tested, safe, and invariant-preserving.
