# Strict Coding Standards: Java + AWS S3

> Status: **strict / enforceable**  
> Audience: LLM code agents, reviewers, maintainers  
> Applies with: `strict-coding-standards__java*.md`, `strict-coding-standards__java_security.md`, `strict-coding-standards__java_network.md`, `strict-coding-standards__java_telemetry.md`, `strict-coding-standards__gradle.md`, `strict-coding-standards__maven.md`

## 0. Purpose

This document is not a tutorial. It is a coding contract. An LLM implementing Java code that touches AWS must follow these rules unless the repository contains a more specific, reviewed architecture decision record.

The default posture is:

- safe by default;
- least privilege by default;
- bounded resource usage by default;
- observable failure by default;
- no hidden network, retry, credential, region, or serialization behavior.

## 1. Global LLM Contract

Before changing code, the LLM MUST identify:

1. AWS service being used.
2. AWS SDK generation and version-management mechanism.
3. region source.
4. credential source.
5. client lifecycle owner.
6. timeout and retry policy.
7. idempotency behavior.
8. data classification of payloads.
9. IAM permissions required.
10. telemetry emitted.
11. tests that prove failure behavior.

If any item is unknown, the LLM MUST mark the implementation as incomplete and add a TODO requiring human review. It MUST NOT silently invent account IDs, ARNs, regions, bucket names, topic names, queue names, KMS keys, secret names, or IAM policies.


## 2. Scope

This file defines strict rules for Java code that reads, writes, lists, deletes, signs, copies, or manages objects in Amazon S3.

It applies to:

- `software.amazon.awssdk.services.s3.S3Client`;
- `S3AsyncClient`;
- S3 Transfer Manager;
- presigned URLs;
- multipart upload/download;
- object metadata/tags;
- encryption;
- event-driven integrations that use S3 keys.

## 3. Client and Dependency Rules

### MUST

- Use AWS SDK for Java 2.x for new S3 code.
- Use `S3Client` for normal blocking object operations.
- Use `S3AsyncClient` or S3 Transfer Manager for high-throughput, large-object, or concurrent transfers.
- Reuse S3 clients.
- Configure region, credentials, timeout, retry, and HTTP client intentionally.
- Treat S3 bucket names, prefixes, and KMS key references as configuration, not constants inside business logic.

### FORBIDDEN

- Creating an S3 client per object.
- Hardcoding production bucket names in library code.
- Using broad IAM examples as production policy.
- Disabling TLS verification.

## 4. Object Key Design

### MUST

- Treat S3 object key as a durable external contract.
- Define key schema explicitly: tenant, domain, object type, date partition, ID, extension.
- Normalize and validate user-controlled path segments before composing keys.
- Use generated opaque IDs when object names come from users.
- Store original filename separately as metadata if needed.
- Avoid leaking user IDs, emails, secrets, or PII in object keys.

### FORBIDDEN

- Directly using user-provided filename as object key.
- Key concatenation that permits `../`, control characters, backslash ambiguity, or empty path segments.
- Assuming S3 has directories. Prefixes are naming convention, not filesystem directories.

## 5. Upload Rules

### MUST

- Use explicit content length when available.
- Use streaming upload for large content.
- Use multipart upload or Transfer Manager for large objects.
- Set content type only from trusted detection/allow-list, not blindly from user input.
- Set content disposition safely for downloads.
- Set encryption configuration where required.
- Add checksum/content integrity validation where required by data classification.
- Abort incomplete multipart upload on failure when managing multipart manually.

### FORBIDDEN

- Loading large files fully into heap before upload.
- Uploading unbounded user input without size limit.
- Trusting browser-provided MIME type as security control.
- Retrying multipart upload without understanding part state.

## 6. Download Rules

### MUST

- Stream downloads for large objects.
- Bound maximum download size when object size is not trusted.
- Validate bucket, key, version ID, and caller authorization before returning content.
- Preserve content-type and content-disposition contract.
- Avoid exposing internal bucket/key naming directly to untrusted users unless designed.

### FORBIDDEN

- `ResponseBytes` or `readAllBytes` for unbounded objects.
- Logging object content.
- Returning raw S3 exceptions to public API clients.

## 7. Presigned URL Rules

### MUST

- Use the SDK S3 presigner for presigned URLs.
- Use short expiration windows.
- Scope presigned URLs to exact method, bucket, key, and headers.
- Treat presigned URL as a bearer credential.
- Never log full presigned URL.
- Validate caller authorization before generating URL.
- Use content length/type constraints where applicable.

### FORBIDDEN

- Long-lived presigned URLs for sensitive content.
- Presigned URL generation without authorization check.
- Presigned upload URL for arbitrary keys.
- Embedding presigned URLs in telemetry attributes.

## 8. Listing and Pagination Rules

### MUST

- Treat S3 list operations as paginated.
- Use prefix and delimiter intentionally.
- Bound list operations by tenant/domain prefix.
- Avoid full-bucket listing in request path.
- Emit telemetry for list page count and object count.

### FORBIDDEN

- Assuming one list response contains all objects.
- Scanning entire production bucket to find one object.
- Listing bucket root for tenant-facing queries.

## 9. Metadata, Tags, and Versioning

### MUST

- Distinguish object metadata, tags, key naming, and database metadata.
- Keep queryable business metadata in database/index if it must be searched frequently.
- Use object tags for lifecycle/security/governance only when operationally justified.
- Handle object versioning explicitly if enabled.
- Include version ID in workflows that require immutable reference.

### FORBIDDEN

- Using S3 metadata as a primary database.
- Assuming delete permanently removes data when versioning or retention is enabled.
- Using tags to store secrets.

## 10. Encryption and Access Control

### MUST

- Use bucket policy/IAM/KMS policy as the primary access control, not application string checks alone.
- Use SSE-S3, SSE-KMS, or client-side encryption according to data classification.
- Record KMS key and encryption context policy when SSE-KMS is used.
- Block public access by default.
- Avoid ACLs unless legacy requirements demand them.

### FORBIDDEN

- Public-read uploads by default.
- Storing secrets in object metadata.
- Client-side encryption without key lifecycle and rotation design.

## 11. Event and Idempotency Rules

### MUST

- Treat S3 events as at-least-once notifications unless the event source guarantees stronger semantics.
- Use bucket/key/version/eTag or application object ID for idempotency.
- Validate event source bucket and key prefix.
- Re-read object metadata when processing critical events.

### FORBIDDEN

- Assuming S3 events arrive exactly once.
- Triggering irreversible side effects from S3 event without idempotency.

## 12. Error Handling Rules

### MUST

- Distinguish not found, access denied, throttling, timeout, precondition failure, and validation errors.
- Avoid returning bucket existence/access details to unauthorized callers.
- Preserve AWS request ID in internal logs.

### FORBIDDEN

- Treating all S3 exceptions as retryable.
- Auto-creating buckets from application request path.

## 13. Testing Rules

### MUST

- Test key generation and path traversal defense.
- Test upload/download size limits.
- Test not found, access denied, timeout, and retry behavior.
- Test presigned URL authorization and expiration policy.
- Test multipart/streaming path for large objects.

### FORBIDDEN

- Tests that hit production buckets.
- Golden files containing real object keys with PII.

## 14. Reviewer Checklist

- [ ] client reused.
- [ ] key schema documented.
- [ ] user filename not used as key directly.
- [ ] large object path streams/multipart.
- [ ] presigned URL short-lived and not logged.
- [ ] encryption policy explicit.
- [ ] list operations paginated and bounded.
- [ ] idempotency for event processing.
- [ ] IAM is least privilege.
- [ ] tests cover negative/failure cases.

## 15. LLM Prompt Contract

For S3 code, the LLM MUST state:

- bucket source;
- key schema;
- object size assumptions;
- upload/download strategy;
- encryption policy;
- presigned URL policy if used;
- IAM actions required;
- failure mapping;
- tests.

## Source Anchors

- S3 examples with AWS SDK for Java 2.x: https://docs.aws.amazon.com/code-library/latest/ug/java_2_s3_code_examples.html
- S3 Transfer Manager for AWS SDK for Java 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/transfer-manager.html
- S3 multipart upload: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-upload-object.html

## Source Anchors

- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x default credentials provider chain: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html
- AWS SDK retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x pagination: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/pagination.html
- AWS Java SDK 1.x end-of-support announcement: https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-java-v1-x-on-december-31-2025/
