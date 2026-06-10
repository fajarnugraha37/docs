# Strict Coding Standards — Go AWS S3

> Purpose: mandatory coding standard for LLM/code-agent generated Go code.
> Scope: implementation, refactoring, testing, code review, and production hardening.
> Rule language: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
> Default SDK: AWS SDK for Go v2 only, unless a project explicitly approves otherwise.

This standard governs Go code that reads from, writes to, lists, signs, copies, deletes, or streams Amazon S3 objects.

## Source Authority

Use these sources as the primary authority when resolving ambiguity:

- AWS SDK for Go v2 Developer Guide: configuration, authentication, retries, timeouts, examples.
- AWS SDK for Go v2 package docs on pkg.go.dev for service clients and operation types.
- AWS service developer guides and API references for service-specific semantics.
- Go official docs for `context`, `net/http`, `io`, `log/slog`, testing, race detector, and modules.
- Project-specific architecture/security standards when stricter than AWS or Go defaults.

When these sources conflict, apply the stricter production-safe rule unless the project owner records an exception.

## Non-Negotiable Rules

1. Use `github.com/aws/aws-sdk-go-v2/service/s3` for direct S3 operations.
2. Use `manager.Uploader` / `manager.Downloader` only when multipart transfer behavior is required and configured.
3. Every S3 operation **MUST** use caller context.
4. S3 bucket names, object keys, prefixes, and metadata **MUST** be validated at the boundary.
5. Object body reads/writes **MUST** be bounded or streaming; unbounded `io.ReadAll` is forbidden for S3 objects unless size is proven small.
6. S3 errors **MUST** be mapped into domain/application categories; do not expose raw AWS errors to API clients.
7. Presigned URLs **MUST** be short-lived, scoped, auditable, and never logged in full.
8. Sensitive objects **MUST** use approved encryption policy, preferably bucket default SSE-KMS or explicit SSE-KMS when required.
9. Delete operations **MUST** be deliberate, auditable, and idempotency-aware.
10. List operations **MUST** be paginated and prefix-bounded.

## Client Construction

```go
type S3Client interface {
    PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
    GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
    DeleteObject(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}
```

Rules:

- Use consumer-owned interfaces with only required operations.
- Bucket name **MUST** be injected config, not caller input.
- Do not share mutable `PutObjectInput` / `GetObjectInput` across goroutines.
- Endpoint override for local testing **MUST** be explicit and environment-bound.

## Bucket and Key Policy

Rules:

- Application code **MUST** treat bucket as infrastructure-owned config.
- Object key **MUST** be derived from domain identifiers using a deterministic, documented scheme.
- Object key **MUST NOT** be raw filename from user input.
- Key generation **MUST** avoid path traversal semantics, even though S3 keys are not filesystem paths.
- Prefix design **SHOULD** support lifecycle, retention, access policy, and operational search.
- Key schema changes **MUST** include backward compatibility/migration plan.

Preferred key construction:

```go
func CaseDocumentKey(caseID, documentID string) (string, error) {
    if !validID(caseID) || !validID(documentID) {
        return "", errors.New("invalid case or document id")
    }
    return fmt.Sprintf("cases/%s/documents/%s/content", caseID, documentID), nil
}
```

Forbidden:

```go
key := r.URL.Query().Get("filename") // BAD: raw user input as object key
```

## PutObject Rules

Rules:

- Body **MUST** be an `io.Reader` with known size or bounded upstream source where possible.
- Content type **MUST** be set from validated detection/metadata, not blindly from user input.
- `ContentLength` **SHOULD** be set when known.
- Object metadata **MUST** be allowlisted and size-controlled.
- Do not store authorization decisions only in metadata.
- Checksum policy **SHOULD** be explicit for integrity-sensitive uploads.
- Encryption policy **MUST** match data classification.

Preferred pattern:

```go
func (s *Store) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
    if err := validateS3Key(key); err != nil {
        return err
    }
    if size < 0 || size > s.maxObjectBytes {
        return fmt.Errorf("invalid object size: %d", size)
    }
    _, err := s.client.PutObject(ctx, &s3.PutObjectInput{
        Bucket:        aws.String(s.bucket),
        Key:           aws.String(key),
        Body:          body,
        ContentLength: aws.Int64(size),
        ContentType:   aws.String(contentType),
    })
    if err != nil {
        return fmt.Errorf("s3 put object key=%s: %w", safeKey(key), err)
    }
    return nil
}
```

## GetObject Rules

Rules:

- Always close `Body`.
- Read body through bounded or streaming path.
- Do not load large objects fully into memory.
- Validate `ContentLength`, `ContentType`, checksum/ETag assumptions, and metadata where relevant.
- Do not treat ETag as MD5 universally; multipart and encrypted objects can have different ETag semantics.
- Map not-found to explicit domain absence.

Preferred pattern:

```go
out, err := client.GetObject(ctx, &s3.GetObjectInput{
    Bucket: aws.String(bucket),
    Key:    aws.String(key),
})
if err != nil {
    return fmt.Errorf("s3 get object key=%s: %w", safeKey(key), err)
}
defer func() { _ = out.Body.Close() }()

n, err := io.Copy(dst, io.LimitReader(out.Body, maxBytes+1))
if err != nil {
    return fmt.Errorf("copy s3 object key=%s: %w", safeKey(key), err)
}
if n > maxBytes {
    return fmt.Errorf("s3 object too large key=%s", safeKey(key))
}
```

## Multipart Upload and Download

Rules:

- Use `feature/s3/manager` only when object size justifies multipart behavior.
- Part size and concurrency **MUST** be configured based on memory and bandwidth budget.
- Multipart upload failures **MUST** be cleaned up or retried according to policy.
- Do not use high concurrency by default in memory-constrained services.
- Streaming uploads **MUST** account for unknown length and retry limitations.

Checklist:

- [ ] Object size class known.
- [ ] Part size configured.
- [ ] Concurrency configured.
- [ ] Memory budget calculated: `part_size * concurrency` plus overhead.
- [ ] Retry/idempotency behavior reviewed.
- [ ] Metrics for bytes, duration, attempts, and failures.

## List and Pagination

Rules:

- `ListObjectsV2` **MUST** be prefix-bounded.
- Listing **MUST** use paginator for multi-page results.
- Code **MUST NOT** assume lexicographic or completeness behavior beyond AWS contract.
- List operations **MUST** have max item/page limits at application boundary.
- UI/API list endpoints **MUST** expose application tokens, not raw internal implementation details unless approved.

## Presigned URLs

Rules:

- Presigned URL expiry **MUST** be short and configured by use case.
- URL **MUST** include only necessary operation, object key, method, headers, and expiry.
- Do not log full presigned URLs.
- Do not persist presigned URLs as durable authorization tokens.
- Do not issue presigned write URLs for arbitrary keys/content types.
- Presigned upload **MUST** bind key, content type, size strategy, and metadata policy where possible.

## Security and Compliance

Rules:

- Sensitive buckets **MUST** block public access at infrastructure level.
- Application code **MUST NOT** weaken bucket policy or ACLs.
- Prefer bucket policy/IAM over object ACLs.
- Object retention/legal hold/lifecycle policies **MUST** be treated as compliance behavior, not incidental storage behavior.
- S3 object contents **MUST NOT** be logged.
- Object keys may reveal sensitive business structure; logs **MUST** redact or hash where required.

## Testing

Required tests:

- Key validation rejects traversal-like and illegal domain inputs.
- PutObject wraps and classifies errors.
- GetObject closes body on success and error paths.
- Large object read is bounded.
- List pagination handles multiple pages.
- Presigned URL creation rejects unauthorized key/content type.
- Multipart config respects memory budget.
- Not-found maps to expected domain error.

## Anti-Patterns

Forbidden:

```go
b, err := io.ReadAll(out.Body) // BAD for unknown/large S3 objects
```

```go
slog.Info("download", "url", presignedURL) // BAD: leaks signed URL
```

```go
input := &s3.PutObjectInput{Bucket: aws.String(userBucket)} // BAD: bucket from caller
```

## Merge Checklist

- [ ] Bucket is config-owned.
- [ ] Key schema is documented and validated.
- [ ] Object size is bounded/streamed.
- [ ] Body is closed for reads.
- [ ] Pagination is used for list operations.
- [ ] Encryption and checksum policy are explicit where needed.
- [ ] Presigned URLs are short-lived and redacted.
- [ ] Error mapping is explicit.
- [ ] Tests cover large object, not-found, timeout, and access denied.
