# Strict Coding Standards — Go AWS Systems Manager / Parameter Store

> Purpose: mandatory coding standard for LLM/code-agent generated Go code.
> Scope: implementation, refactoring, testing, code review, and production hardening.
> Rule language: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
> Default SDK: AWS SDK for Go v2 only, unless a project explicitly approves otherwise.

This standard governs Go code that uses AWS Systems Manager through the AWS SDK for Go v2, especially Parameter Store reads/writes. The filename uses `system_manager` for project naming consistency, while the AWS service name is **Systems Manager** and the Go package is `ssm`.

## Source Authority

Use these sources as the primary authority when resolving ambiguity:

- AWS SDK for Go v2 Developer Guide: configuration, authentication, retries, timeouts, examples.
- AWS SDK for Go v2 package docs on pkg.go.dev for service clients and operation types.
- AWS service developer guides and API references for service-specific semantics.
- Go official docs for `context`, `net/http`, `io`, `log/slog`, testing, race detector, and modules.
- Project-specific architecture/security standards when stricter than AWS or Go defaults.

When these sources conflict, apply the stricter production-safe rule unless the project owner records an exception.

## Non-Negotiable Rules

1. Use `github.com/aws/aws-sdk-go-v2/service/ssm`.
2. Parameter names **MUST** be config-owned or derived from an allowlisted logical name.
3. User input **MUST NOT** directly select arbitrary SSM parameter names or document names.
4. `WithDecryption` **MUST** be explicit when reading SecureString parameters.
5. Parameter values **MUST NOT** be logged if they contain secrets or sensitive config.
6. Parameter schema/type **MUST** be validated after retrieval.
7. Frequent parameter reads **SHOULD** use caching with TTL and refresh policy.
8. Writes/updates/deletes **MUST** be restricted to explicit config-management components.
9. Pagination **MUST** be used for recursive/path parameter reads.
10. Parameter Store **MUST NOT** be treated as a high-throughput hot-path database.

## Client Boundary

```go
type SSMClient interface {
    GetParameter(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error)
    GetParametersByPath(ctx context.Context, params *ssm.GetParametersByPathInput, optFns ...func(*ssm.Options)) (*ssm.GetParametersByPathOutput, error)
}
```

Rules:

- Infrastructure package maps logical config keys to SSM names.
- Business/domain code **MUST NOT** know SSM paths.
- Parameter reads **MUST** use bounded context.
- Parameter paths **MUST** include environment/application prefix.

Example path convention:

```text
/{environment}/{application}/{component}/{name}
/prod/case-service/database/read-timeout
/prod/case-service/integrations/onemap/base-url
```

## GetParameter Rules

Preferred:

```go
func (s *Store) GetString(ctx context.Context, logicalName string) (string, error) {
    name, ok := s.names[logicalName]
    if !ok || name == "" {
        return "", fmt.Errorf("ssm parameter mapping not configured: %s", logicalName)
    }

    out, err := s.client.GetParameter(ctx, &ssm.GetParameterInput{
        Name:           aws.String(name),
        WithDecryption: aws.Bool(s.decrypt[logicalName]),
    })
    if err != nil {
        return "", fmt.Errorf("get ssm parameter logical=%s: %w", logicalName, err)
    }
    if out.Parameter == nil || out.Parameter.Value == nil {
        return "", fmt.Errorf("ssm parameter has no value logical=%s", logicalName)
    }
    return *out.Parameter.Value, nil
}
```

Rules:

- `Name` **MUST** be trusted.
- `WithDecryption` **MUST** be intentionally set based on parameter classification.
- Returned type/version/ARN **SHOULD** be checked for critical config.
- Empty values **MUST** be rejected unless allowed by config schema.

## GetParametersByPath Rules

Rules:

- Recursive reads **MUST** be path-bounded to environment/application prefix.
- Use paginators or loop with `NextToken` until complete or limit reached.
- Apply max parameter count limit.
- Validate every parameter name belongs to expected prefix.
- Do not expose path-read APIs to untrusted callers.

## SecureString Rules

- SecureString values **MUST** be treated like secrets.
- Logs/errors/metrics/traces **MUST NOT** include value.
- `WithDecryption` **MUST** be false unless decrypted value is required in-process.
- Decrypted values **MUST** stay in memory only as long as needed.
- IAM/KMS permissions **MUST** be least-privilege.

## Parameter vs Secrets Manager Decision

Use SSM Parameter Store for:

- non-secret config
- low-frequency configuration lookup
- hierarchical application parameters
- simple SecureString secrets where rotation/caching requirements are modest

Use Secrets Manager for:

- secrets with rotation lifecycle
- database credentials managed by AWS rotation
- secrets requiring dedicated secret caching semantics
- sensitive data with stricter lifecycle controls

The LLM **MUST NOT** choose between SSM SecureString and Secrets Manager arbitrarily. The choice must follow architecture/security policy.

## Write/Update/Delete Rules

Rules:

- Application runtime **SHOULD NOT** mutate parameters unless it is a config-control component.
- `Overwrite` **MUST** be deliberate and audited.
- Parameter type changes **MUST** be migration-reviewed.
- Deletes **MUST** require runbook or explicit ownership.
- Writes **MUST** avoid storing user-provided arbitrary values under privileged paths.

## Caching

Rules:

- Cache TTL **MUST** be explicit.
- Cache key **MUST** be logical config name, not arbitrary path from caller.
- Refresh failure policy **MUST** be explicit: fail closed or use last-known-good for bounded time.
- Sensitive cache values **MUST NOT** be dumped through debug/admin endpoints.

## Testing

Required tests:

- Logical name maps to expected parameter name.
- Arbitrary/unmapped parameter names are rejected.
- `WithDecryption` is set correctly for SecureString.
- Missing parameter maps to configuration/dependency error.
- Empty/malformed value fails schema validation.
- Pagination handles multiple pages.
- Cache hit/miss/refresh failure is deterministic.
- Redaction prevents value leakage.

## Anti-Patterns

Forbidden:

```go
name := r.URL.Query().Get("name")
out, _ := client.GetParameter(ctx, &ssm.GetParameterInput{Name: aws.String(name)})
```

```go
slog.Info("ssm parameter", "value", *out.Parameter.Value)
```

```go
// BAD: hot-path per-request config lookup.
func handler(w http.ResponseWriter, r *http.Request) {
    timeout, _ := store.GetString(r.Context(), "request_timeout")
    _ = timeout
}
```

## Merge Checklist

- [ ] Parameter name is trusted/config-owned.
- [ ] Path prefix is environment/application scoped.
- [ ] SecureString decryption is explicit.
- [ ] Sensitive values are redacted.
- [ ] Parameter schema is validated.
- [ ] Cache and refresh behavior are explicit if used.
- [ ] Pagination is used for path reads.
- [ ] Writes/deletes are explicitly approved.
