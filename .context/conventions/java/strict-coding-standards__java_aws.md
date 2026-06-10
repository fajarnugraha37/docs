# Strict Coding Standards: Java + AWS SDK

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

This file defines the general AWS integration standard for Java. Service-specific files such as S3, Secrets Manager, Systems Manager, SNS, and SQS may add stricter rules.

This file covers:

- AWS SDK for Java 2.x dependency governance;
- credential and region resolution;
- client lifecycle;
- sync vs async clients;
- HTTP client configuration;
- timeout and retry policy;
- pagination;
- idempotency;
- error handling;
- IAM/security;
- telemetry;
- testing.

## 3. Version and Dependency Governance

### MUST

- Use **AWS SDK for Java 2.x** for new code.
- Manage SDK dependencies through the AWS SDK BOM or a central version catalog.
- Pin the SDK version. Do not use dynamic versions such as `latest.release`, `+`, `LATEST`, or unbounded ranges.
- Keep SDK service modules minimal. Add only the modules used by the application.
- Keep HTTP client dependency explicit when the service client needs tuning or non-default behavior.
- Record the selected SDK version and reason in dependency governance documentation.

### FORBIDDEN

- Adding AWS SDK for Java 1.x to new code.
- Mixing SDK v1 and SDK v2 in the same module unless the module is explicitly marked as a legacy migration bridge.
- Depending on transitive service modules accidentally.
- Adding both multiple HTTP client implementations without documenting which client is active.

### Maven Example

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>${aws.sdk.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### Gradle Example

```kotlin
dependencies {
    implementation(platform("software.amazon.awssdk:bom:$awsSdkVersion"))
    implementation("software.amazon.awssdk:s3")
    implementation("software.amazon.awssdk:sts")
}
```

## 4. Credential Rules

### MUST

- Prefer the SDK default credentials provider chain for normal runtime environments.
- Use IAM roles, workload identity, or instance/task/pod identity instead of static access keys where available.
- Make local developer credentials explicit through profiles, SSO, or environment configuration.
- Ensure credentials are short-lived wherever possible.
- Scope IAM permissions to exact actions and resources.
- Separate read, write, admin, and migration permissions.

### FORBIDDEN

- Hardcoding access keys, secret keys, session tokens, account IDs, or role ARNs in source code.
- Reading AWS credentials from arbitrary files invented by the LLM.
- Logging credential provider output.
- Falling back to broad admin credentials when a service call fails.
- Using root-account credentials in tests, scripts, or examples.

## 5. Region Rules

### MUST

- Make region resolution explicit at application boundary.
- Use environment/config/profile/provider chain intentionally.
- Avoid hardcoding region in reusable libraries.
- Validate that resource names/ARNs are in the expected region when region matters.

### FORBIDDEN

- Silent fallback to `us-east-1` unless it is explicitly the product default.
- Cross-region calls without a design note.
- Creating regional clients per request.

## 6. Client Lifecycle Rules

### MUST

- Reuse AWS SDK clients.
- Create clients at application composition/root layer.
- Close clients only when the application component owning the client is shutting down.
- Treat service clients as thread-safe shared infrastructure components.
- Name wrapper classes by service and responsibility, for example `S3ObjectStore`, `SqsOrderQueue`, `SecretsProvider`.

### FORBIDDEN

- Creating a new SDK client per request/message/file.
- Hiding client construction inside low-level domain methods.
- Mutating shared client configuration after startup.
- Letting tests use real AWS by accident.

## 7. HTTP Client, Timeout, and Retry Rules

### MUST

- Configure API call timeout and API call attempt timeout for all critical clients.
- Configure connection timeout and socket/read/write timeout where supported by the selected HTTP client.
- Use SDK standard retry mode unless a documented reason exists.
- Make adaptive retry mode an architecture decision, not a default.
- Ensure retries are safe for the operation semantics.
- Add circuit breaking/bulkhead at application boundary if downstream degradation can exhaust threads or event loops.

### FORBIDDEN

- Infinite or unbounded retries.
- Blind retry of non-idempotent operations.
- No timeout on production AWS calls.
- Custom retry loops wrapped around SDK retries without a clear combined budget.
- Blocking event-loop threads in async client callbacks.

## 8. Sync vs Async Client Rules

### Sync Client SHOULD be used when

- request rate is moderate;
- call site is already blocking;
- service integration is simple;
- simplicity matters more than high concurrency.

### Async Client SHOULD be used when

- concurrency is high;
- streaming or non-blocking integration matters;
- the application already has a reactive/event-loop architecture;
- the team can reason about backpressure and lifecycle.

### FORBIDDEN

- Using async client then immediately blocking on every future in hot path.
- Using sync client in a virtual-thread or thread-per-request architecture without validating downstream connection limits.
- Using async client without max concurrency, event-loop, timeout, and backpressure design.

## 9. Pagination Rules

### MUST

- Treat AWS list/query/scan APIs as paginated unless the service API explicitly guarantees otherwise.
- Use SDK paginators where they improve correctness.
- Bound total records read by business limit.
- Avoid materializing all pages in memory unless the maximum result size is known and small.
- Emit telemetry for page count and item count for large operations.

### FORBIDDEN

- Assuming the first page contains all results.
- Ignoring `NextToken` / continuation token.
- Converting paginated API output directly to unbounded `List` in production paths.

## 10. Error Handling Rules

### MUST

- Catch specific AWS service exceptions at service boundary.
- Preserve request ID and AWS error code in internal diagnostics.
- Map AWS failures to domain/application errors intentionally.
- Treat throttling, timeout, access denied, not found, validation failure, and conflict differently.
- Avoid leaking AWS internal details to public API users.

### FORBIDDEN

- Catching `Exception` and returning success/default value.
- Treating `AccessDenied` as `NotFound` unless the product explicitly chooses security-by-obscurity and records it.
- Logging full request payloads or secret values on AWS errors.

## 11. Idempotency Rules

### MUST

- Identify whether the AWS operation is idempotent.
- Provide client tokens, message deduplication IDs, conditional writes, object keys, or idempotency tables where required.
- Make retry behavior compatible with side effects.
- For external callers, expose idempotency keys for command-style operations.

### FORBIDDEN

- Generating random keys for retry-sensitive writes inside retry loops.
- Retrying create/publish/send operations without an idempotency plan.

## 12. Serialization and Payload Rules

### MUST

- Use explicit DTOs for AWS payloads.
- Define JSON mapper behavior centrally if AWS payload contains JSON.
- Bound payload size before sending.
- Compress only with explicit content encoding/metadata contract.
- Never log raw payloads that may contain secrets, PII, tokens, credentials, session data, or business-sensitive data.

### FORBIDDEN

- Java native serialization for AWS payloads.
- Unversioned binary payloads.
- Relying on platform default charset.

## 13. IAM and Security Rules

### MUST

- Maintain least-privilege IAM policy for every integration.
- Prefer resource-scoped permissions.
- Use condition keys where relevant, such as source account, source ARN, VPC endpoint, encryption context, or tag conditions.
- Separate application runtime role from deployment/migration/admin roles.
- Use KMS consciously for encrypted data.
- Deny plaintext secrets in logs and telemetry.

### FORBIDDEN

- `Action: "*"` or `Resource: "*"` in application runtime examples unless explicitly marked as unacceptable placeholder.
- Embedding IAM policy snippets with fake broad permissions as if production-ready.
- Disabling TLS verification.

## 14. Observability Rules

### MUST

- Emit service name, operation name, region, attempt count, latency, error category, request ID when safe, and resource logical name.
- Correlate AWS calls with trace/span context.
- Track retry count, throttling, timeout, and error code metrics.
- Redact secrets, signed URLs, tokens, account-sensitive IDs, and message payloads.

### FORBIDDEN

- Logging full presigned URLs.
- Logging AWS credentials or authorization headers.
- Using CloudWatch/AWS request ID as the only correlation ID.

## 15. Testing Rules

### MUST

- Unit-test mapping, error handling, idempotency, and retry budget logic without real AWS.
- Integration-test against LocalStack/Testcontainers or isolated AWS test resources where appropriate.
- Never let tests run against production account by default.
- Make test region/account/resource names explicit.
- Assert that timeouts and retries are configured.

### FORBIDDEN

- Tests that require a developer's personal AWS account without opt-in.
- Snapshot tests containing real ARNs, account IDs, or secrets.
- Tests that depend on real AWS service timing without stabilization.

## 16. Reviewer Checklist

- [ ] SDK v2 used for new code.
- [ ] SDK version pinned through BOM/version catalog.
- [ ] credentials not hardcoded.
- [ ] region explicit and correct.
- [ ] client reused and lifecycle-owned.
- [ ] timeouts configured.
- [ ] retry mode and idempotency compatible.
- [ ] pagination handled.
- [ ] IAM policy least-privilege.
- [ ] no sensitive logs.
- [ ] telemetry includes operation latency/error/retry.
- [ ] tests cover success, not found, access denied, throttling, timeout, and retry behavior.

## 17. LLM Prompt Contract

When generating Java AWS code, the LLM MUST output:

1. selected AWS SDK modules;
2. client construction location;
3. timeout/retry config;
4. credential/region source;
5. IAM actions/resources required;
6. idempotency behavior;
7. failure mapping;
8. telemetry fields;
9. tests.

If it cannot provide these, it MUST not claim the implementation is production-ready.


## Source Anchors

- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x default credentials provider chain: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html
- AWS SDK retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x pagination: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/pagination.html
- AWS Java SDK 1.x end-of-support announcement: https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-java-v1-x-on-december-31-2025/
