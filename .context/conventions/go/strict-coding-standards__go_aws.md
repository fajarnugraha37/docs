# Strict Coding Standards — Go AWS Integration

> Purpose: mandatory coding standard for LLM/code-agent generated Go code.
> Scope: implementation, refactoring, testing, code review, and production hardening.
> Rule language: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
> Default SDK: AWS SDK for Go v2 only, unless a project explicitly approves otherwise.

This standard governs all Go code that integrates with AWS services. It is the parent standard for service-specific AWS standards such as S3, Secrets Manager, SNS, SQS, and Systems Manager.

## Source Authority

Use these sources as the primary authority when resolving ambiguity:

- AWS SDK for Go v2 Developer Guide: configuration, authentication, retries, timeouts, examples.
- AWS SDK for Go v2 package docs on pkg.go.dev for service clients and operation types.
- AWS service developer guides and API references for service-specific semantics.
- Go official docs for `context`, `net/http`, `io`, `log/slog`, testing, race detector, and modules.
- Project-specific architecture/security standards when stricter than AWS or Go defaults.

When these sources conflict, apply the stricter production-safe rule unless the project owner records an exception.

## Non-Negotiable Rules

1. Go AWS integrations **MUST** use AWS SDK for Go v2 packages, for example `github.com/aws/aws-sdk-go-v2/config` and service clients under `github.com/aws/aws-sdk-go-v2/service/...`.
2. Code **MUST NOT** use AWS SDK for Go v1 in new implementation.
3. Every AWS call **MUST** accept and propagate `context.Context` from the caller.
4. AWS clients **MUST** be constructed at application bootstrap and injected as dependencies.
5. Code **MUST NOT** create a new AWS client per request, message, job, or loop iteration.
6. Region, endpoint override, retry policy, timeout, and credentials source **MUST** be explicit in application configuration.
7. Credentials **MUST NOT** be hardcoded, logged, embedded in test fixtures, or accepted through arbitrary request input.
8. IAM permissions **MUST** be least-privilege and service-specific.
9. All AWS operation errors **MUST** be wrapped with operation, resource category, and retryability context, while redacting sensitive identifiers when required.
10. All production AWS interactions **MUST** be observable through structured logs, metrics, and traces where the project telemetry standard requires it.

## Dependency and Module Rules

### Required dependencies

```bash
go get github.com/aws/aws-sdk-go-v2
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/aws/retry
```

Service clients **MUST** be imported only when used:

```bash
go get github.com/aws/aws-sdk-go-v2/service/s3
go get github.com/aws/aws-sdk-go-v2/service/secretsmanager
go get github.com/aws/aws-sdk-go-v2/service/sns
go get github.com/aws/aws-sdk-go-v2/service/sqs
go get github.com/aws/aws-sdk-go-v2/service/ssm
```

Rules:

- `go.mod` and `go.sum` **MUST** be committed together.
- AWS SDK dependency upgrades **MUST** be reviewed as dependency updates, not hidden inside feature changes.
- Code **MUST NOT** import all AWS service clients into a shared infrastructure package “just in case”.
- Generated mocks or hand-written ports **MUST** depend only on the minimal operation set used by the application.

## Configuration Loading

Preferred bootstrap:

```go
func LoadAWSConfig(ctx context.Context, region string, optFns ...func(*config.LoadOptions) error) (aws.Config, error) {
    if region == "" {
        return aws.Config{}, errors.New("aws region is required")
    }

    cfg, err := config.LoadDefaultConfig(ctx,
        append([]func(*config.LoadOptions) error{
            config.WithRegion(region),
        }, optFns...)...,
    )
    if err != nil {
        return aws.Config{}, fmt.Errorf("load aws config: %w", err)
    }
    return cfg, nil
}
```

Rules:

- `config.LoadDefaultConfig` **MUST** run during startup, not in hot paths.
- Region **MUST** be configured explicitly by environment/config file/deployment config.
- Endpoint override **MUST** be environment-specific and guarded; it is acceptable for LocalStack/tests but must not silently affect production.
- Shared config loading **MUST** fail fast when mandatory region/profile/role assumptions are missing.
- Application config **MUST NOT** expose raw AWS credentials through HTTP/admin API.

## Credentials and Identity

Credentials **MUST** come from a trusted AWS credential provider chain or workload identity, such as IAM role for ECS/EKS/EC2/Lambda, web identity, profile for local dev, or dedicated CI identity.

Rules:

- Static access keys **MUST NOT** be used in production workload configuration unless explicitly approved as an exception.
- Temporary credentials **SHOULD** be preferred.
- Assumed role session name **SHOULD** include application/environment identity, not user-provided uncontrolled strings.
- Logs **MUST NOT** include access key ID, secret access key, session token, signed authorization headers, presigned URLs, or raw credentials provider output.
- Code **MUST NOT** implement custom credential signing logic unless the AWS SDK cannot support the required flow and the exception is reviewed.

## Client Construction and Injection

Preferred pattern:

```go
type S3API interface {
    PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type ObjectStore struct {
    s3     S3API
    bucket string
}

func NewObjectStore(client S3API, bucket string) (*ObjectStore, error) {
    if client == nil {
        return nil, errors.New("s3 client is required")
    }
    if bucket == "" {
        return nil, errors.New("s3 bucket is required")
    }
    return &ObjectStore{s3: client, bucket: bucket}, nil
}
```

Rules:

- Interfaces **MUST** be consumer-owned and minimal.
- Do not depend on broad generated `iface` interfaces if they include many operations and create upgrade fragility.
- Service clients **MAY** be shared concurrently when SDK docs allow it; callers still **MUST** treat request input/output objects as per-call values.
- Do not mutate shared client options dynamically after construction.

## Context, Timeout, and Cancellation

Rules:

- AWS call wrappers **MUST** accept `ctx context.Context` as the first parameter.
- Callers **MUST** set an appropriate timeout/deadline before AWS operations that cross a network boundary.
- Library functions **MUST NOT** create arbitrary long top-level timeouts that override caller intent.
- AWS calls in message consumers **MUST** respect the message visibility/deadline budget.
- AWS calls during shutdown **MUST** use bounded shutdown context, not `context.Background()`.

Preferred pattern:

```go
func (s *ObjectStore) Put(ctx context.Context, key string, body io.Reader) error {
    if key == "" {
        return errors.New("s3 key is required")
    }
    _, err := s.s3.PutObject(ctx, &s3.PutObjectInput{
        Bucket: aws.String(s.bucket),
        Key:    aws.String(key),
        Body:   body,
    })
    if err != nil {
        return fmt.Errorf("put s3 object bucket=%s key=%s: %w", safeBucket(s.bucket), safeKey(key), err)
    }
    return nil
}
```

## Retry and Backoff

Rules:

- Retry policy **MUST** be explicit for production workloads.
- Code **MUST NOT** add ad-hoc retry loops around AWS SDK calls unless it coordinates with the SDK retryer and operation idempotency.
- Retryable and non-retryable errors **MUST** be classified at the application boundary.
- Retried operations **MUST** be idempotent or include idempotency keys/tokens where the AWS service supports them.
- Retry attempts **MUST** be bounded.
- Retry metrics **SHOULD** include service, operation, outcome, and retry count without high-cardinality resource IDs.

Preferred configuration sketch:

```go
cfg, err := config.LoadDefaultConfig(ctx,
    config.WithRegion(region),
    config.WithRetryer(func() aws.Retryer {
        return retry.AddWithMaxAttempts(retry.NewStandard(), 3)
    }),
)
```

## Error Handling

Rules:

- Use `fmt.Errorf("operation context: %w", err)` when returning errors.
- Do not match AWS errors through string comparison.
- Use typed AWS/smithy error inspection where needed.
- Error logs **MUST** include operation and stable classification.
- Error logs **MUST NOT** include secret values, raw message bodies, raw object contents, or complete presigned URLs.

Recommended categories:

- `configuration_error`
- `credential_error`
- `authorization_error`
- `not_found`
- `conflict`
- `rate_limited`
- `transient_dependency_error`
- `permanent_dependency_error`
- `serialization_error`
- `timeout_or_cancelled`

## Observability

Rules:

- Every AWS wrapper **SHOULD** log operation outcome at the boundary, not deep inside shared retry loops.
- Metrics **SHOULD** record latency, success/failure, retries, throttling, and timeout count per service/operation.
- Trace spans **SHOULD** include AWS service and operation names.
- Resource identifiers **MUST** be cardinality-controlled before becoming metric labels.
- Sensitive request/response payloads **MUST NOT** be attached to traces.

Example stable metric labels:

```text
aws_service=s3
aws_operation=PutObject
outcome=success|error|timeout|cancelled
error_class=throttled|access_denied|not_found|unknown
```

## Testing Rules

- Unit tests **MUST** use consumer-owned interfaces or local fake clients.
- Integration tests **MUST** be gated with build tags or environment variables.
- Tests **MUST NOT** depend on default developer AWS profile unless explicitly marked manual.
- Tests touching real AWS **MUST** use disposable resources, unique names, and cleanup with bounded context.
- LocalStack-style tests **MAY** be used for behavior approximation, but service semantics that affect correctness **MUST** be validated against AWS docs or dedicated integration tests.
- Error-path tests **MUST** cover throttling, access denied, not found, timeout, cancellation, malformed response/input, and dependency outage.

## Security Rules

- IAM actions **MUST** be least-privilege per application use case.
- Resource ARNs **MUST** be environment-scoped.
- Cross-account access **MUST** be explicit and auditable.
- KMS key usage **MUST** be explicit for services storing sensitive data.
- User-controlled strings **MUST NOT** directly become bucket names, parameter names, topic ARNs, queue URLs, role ARNs, or endpoint URLs without allowlist validation.
- SDK debug logging **MUST NOT** be enabled in production if it can emit sensitive request metadata.

## Anti-Patterns

Forbidden:

```go
// BAD: client created per request.
func handler(w http.ResponseWriter, r *http.Request) {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    client := s3.NewFromConfig(cfg)
    _ = client
}
```

```go
// BAD: no context propagation, no timeout, no error context.
_, _ = client.Publish(context.Background(), input)
```

```go
// BAD: hardcoded credentials.
os.Setenv("AWS_SECRET_ACCESS_KEY", "...")
```

```go
// BAD: logs sensitive data.
slog.Info("secret loaded", "value", secretString)
```

## Merge Checklist

A change that integrates with AWS is mergeable only if:

- [ ] AWS SDK for Go v2 is used.
- [ ] Client construction is centralized and injected.
- [ ] Region and endpoint behavior are explicit.
- [ ] Credentials are not hardcoded or logged.
- [ ] IAM/resource scope is least-privilege.
- [ ] Every AWS call receives caller context.
- [ ] Timeout/retry policy is explicit and bounded.
- [ ] Error handling classifies dependency failures safely.
- [ ] Logs/metrics/traces are present and redacted.
- [ ] Unit tests use minimal interfaces/fakes.
- [ ] Integration tests are gated and cleanup resources.
- [ ] Security review is completed for public network, secret, or cross-account use.
