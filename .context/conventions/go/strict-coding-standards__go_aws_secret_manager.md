# Strict Coding Standards — Go AWS Secrets Manager

> Purpose: mandatory coding standard for LLM/code-agent generated Go code.
> Scope: implementation, refactoring, testing, code review, and production hardening.
> Rule language: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
> Default SDK: AWS SDK for Go v2 only, unless a project explicitly approves otherwise.

This standard governs Go code that retrieves, caches, rotates, or writes secrets through AWS Secrets Manager.

## Source Authority

Use these sources as the primary authority when resolving ambiguity:

- AWS SDK for Go v2 Developer Guide: configuration, authentication, retries, timeouts, examples.
- AWS SDK for Go v2 package docs on pkg.go.dev for service clients and operation types.
- AWS service developer guides and API references for service-specific semantics.
- Go official docs for `context`, `net/http`, `io`, `log/slog`, testing, race detector, and modules.
- Project-specific architecture/security standards when stricter than AWS or Go defaults.

When these sources conflict, apply the stricter production-safe rule unless the project owner records an exception.

## Non-Negotiable Rules

1. Use `github.com/aws/aws-sdk-go-v2/service/secretsmanager` for direct operations.
2. Secret values **MUST NEVER** be logged, traced, returned in error messages, exposed in metrics, or written to debug dumps.
3. Applications **SHOULD** use client-side caching for frequently read secrets.
4. Every secret retrieval **MUST** use caller context and bounded timeout.
5. Secret identifiers **MUST** be config-owned or allowlisted; user input **MUST NOT** directly choose arbitrary secret IDs.
6. Code **MUST** handle both `SecretString` and `SecretBinary` deliberately; do not assume both are present.
7. Secret schema **MUST** be validated after retrieval and before use.
8. Rotation-aware code **MUST** handle current/previous version semantics when required.
9. Secret write/update/delete operations **MUST** require explicit security approval.
10. Tests **MUST** prove redaction behavior.

## Client Boundary

Preferred port:

```go
type SecretReader interface {
    GetSecretValue(ctx context.Context, params *secretsmanager.GetSecretValueInput, optFns ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error)
}

type Secrets struct {
    client SecretReader
    names  map[string]string
}
```

Rules:

- Do not pass a raw Secrets Manager client throughout business code.
- Create a narrow domain-specific secret provider, for example `DatabaseCredentialsProvider`.
- Secret names/ARNs **MUST** be mapped from logical config keys.
- The application **MUST** fail fast if required secret references are missing.

## Retrieval Rules

Preferred pattern:

```go
func (s *Secrets) DatabaseCredentials(ctx context.Context) (DBCredentials, error) {
    secretID := s.names["database"]
    if secretID == "" {
        return DBCredentials{}, errors.New("database secret id is not configured")
    }

    out, err := s.client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
        SecretId: aws.String(secretID),
    })
    if err != nil {
        return DBCredentials{}, fmt.Errorf("get database secret: %w", err)
    }

    raw, err := secretBytes(out)
    if err != nil {
        return DBCredentials{}, fmt.Errorf("decode database secret envelope: %w", err)
    }

    creds, err := parseDBCredentials(raw)
    if err != nil {
        return DBCredentials{}, fmt.Errorf("parse database secret: %w", err)
    }
    return creds, nil
}
```

Rules:

- `SecretId` **MUST** come from trusted config.
- Code **MUST** validate returned version/stage if rotation semantics matter.
- Missing secret, denied access, malformed JSON, and timeout **MUST** be distinct error categories.
- Code **MUST NOT** swallow secret retrieval failure and silently use insecure defaults.

## SecretString and SecretBinary

Rules:

- If `SecretString != nil`, parse as UTF-8 text only when the secret contract says it is text/JSON.
- If `SecretBinary != nil`, treat as bytes and avoid string conversion unless required.
- If both are nil, return configuration/dependency error.
- If both are populated unexpectedly, follow project contract; usually reject as malformed.

Helper:

```go
func secretBytes(out *secretsmanager.GetSecretValueOutput) ([]byte, error) {
    switch {
    case out == nil:
        return nil, errors.New("nil secret output")
    case out.SecretString != nil && out.SecretBinary != nil:
        return nil, errors.New("secret has both string and binary values")
    case out.SecretString != nil:
        return []byte(*out.SecretString), nil
    case out.SecretBinary != nil:
        return append([]byte(nil), out.SecretBinary...), nil
    default:
        return nil, errors.New("secret has no value")
    }
}
```

## Caching Policy

Rules:

- Frequent secret reads **SHOULD** use a cache to reduce latency and cost.
- Cache TTL **MUST** be shorter than or compatible with rotation and incident response requirements.
- Cache refresh failure **MUST** have explicit behavior: continue last-known-good, fail closed, or fail open only with approval.
- Cache **MUST NOT** expose raw secret values through debug endpoints.
- Cache eviction/rotation **SHOULD** be observable without logging values.

Design decision required:

```text
secret_name: logical/application name
cache_ttl: duration
rotation_window: duration or policy
on_refresh_failure: fail_closed | last_known_good_for_duration
startup_behavior: fail_fast | lazy_load
```

## Secret Schema Validation

Rules:

- Secrets containing JSON **MUST** be decoded into dedicated struct types.
- Unknown fields **SHOULD** be rejected for internal secret schemas.
- Required fields **MUST** be checked explicitly.
- Empty passwords/tokens/keys **MUST** be rejected unless contract explicitly allows them.
- Do not treat secret existence as proof of validity.

Example:

```go
type DBCredentials struct {
    Username string `json:"username"`
    Password string `json:"password"`
    Host     string `json:"host"`
    Port     int    `json:"port"`
}

func (c DBCredentials) Validate() error {
    switch {
    case c.Username == "":
        return errors.New("username is required")
    case c.Password == "":
        return errors.New("password is required")
    case c.Host == "":
        return errors.New("host is required")
    case c.Port <= 0 || c.Port > 65535:
        return errors.New("port is invalid")
    default:
        return nil
    }
}
```

## Logging and Redaction

Allowed log fields:

- logical secret purpose, e.g. `database_credentials`
- operation, e.g. `GetSecretValue`
- result, e.g. `success`, `access_denied`, `not_found`, `timeout`
- cache outcome, e.g. `hit`, `miss`, `refresh_failed`

Forbidden log fields:

- `SecretString`
- `SecretBinary`
- parsed credential values
- access tokens
- passwords
- private keys
- full secret ARN if classified sensitive by project policy

## Write/Update/Delete Rules

- New code **MUST NOT** create, update, rotate, or delete secrets unless the service is explicitly responsible for secret lifecycle.
- Rotation Lambdas/services **MUST** follow documented staging-label semantics.
- Write operations **MUST** be auditable.
- Destructive operations **MUST** require a human-approved runbook or explicit lifecycle controller.

## Testing

Required tests:

- Redaction test verifies no secret value appears in logs/errors.
- Missing secret maps to safe config/dependency error.
- Access denied maps to authorization/dependency error.
- Malformed JSON fails validation.
- Empty required fields fail validation.
- Cache hit/miss/refresh-failure behavior is deterministic.
- Context cancellation aborts retrieval.

## Anti-Patterns

Forbidden:

```go
slog.Info("loaded secret", "secret", *out.SecretString)
```

```go
secretID := r.URL.Query().Get("secret") // BAD: arbitrary secret selection
```

```go
return fmt.Errorf("bad secret %s", *out.SecretString) // BAD: leak
```

## Merge Checklist

- [ ] Secret ID comes from trusted config/allowlist.
- [ ] Context and timeout are propagated.
- [ ] Secret value is never logged or traced.
- [ ] Secret schema is validated.
- [ ] Cache behavior is explicit where used.
- [ ] Rotation/staging semantics are reviewed if relevant.
- [ ] Tests cover missing, denied, malformed, redaction, and cancellation cases.
