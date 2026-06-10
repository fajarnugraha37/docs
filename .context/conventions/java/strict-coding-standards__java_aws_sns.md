# Strict Coding Standards: Java + AWS SNS

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

This file defines strict rules for Java code publishing to or administering Amazon SNS topics.

It applies to:

- `SnsClient`;
- standard topics;
- FIFO topics;
- message attributes;
- subscription filter policies;
- fanout to SQS/Lambda/HTTP/SMS/email;
- DLQ configuration for subscriptions;
- publisher-side idempotency.

## 3. SNS Usage Model

### MUST

- Use SNS for fanout/pub-sub notification, not as a work queue.
- Define topic ownership, producer ownership, subscriber contract, and message schema.
- Distinguish standard topic vs FIFO topic explicitly.
- Use SQS for durable worker queueing when consumers need independent retry/backpressure.

### FORBIDDEN

- Treating SNS publish as exactly-once delivery to every subscriber.
- Putting business-critical state only in an SNS message without durable source-of-truth.
- Using SNS as an RPC mechanism.

## 4. Client and Dependency Rules

### MUST

- Use AWS SDK for Java 2.x.
- Reuse `SnsClient`.
- Configure region, credentials, timeout, retry, and failure mapping.
- Wrap publish behavior in a domain-specific publisher, for example `OrderEventPublisher`.

### FORBIDDEN

- Creating client per publish.
- Publishing directly from domain entity methods.
- Hardcoding topic ARN inside business logic.

## 5. Topic and Message Contract

### MUST

- Define topic ARN source through config/infrastructure output.
- Define message type, version, schema, producer, and compatibility rule.
- Include stable event ID/correlation ID where appropriate.
- Use message attributes for routing/filtering metadata, not full payload duplication.
- Bound message size and reject oversized payloads before publish.

### FORBIDDEN

- Unversioned JSON payloads.
- Sensitive data in subject, attributes, or message fields unless explicitly approved.
- Using message attributes for secrets.
- Publishing raw domain object serialization.

## 6. Standard Topic Rules

### MUST

- Treat delivery as at-least-once and unordered unless the target/subscription provides stronger behavior.
- Make subscribers idempotent.
- Design duplicate event handling.
- Use event ID and source aggregate/version for deduplication.

### FORBIDDEN

- Assuming order across messages.
- Triggering irreversible side effects in subscribers without idempotency.

## 7. FIFO Topic Rules

### MUST

- Use FIFO topic only when ordering/deduplication requirements justify constraints.
- Set message group ID deliberately.
- Set deduplication ID or use content-based dedup only when payload stability is acceptable.
- Define partitioning/order key strategy.

### FORBIDDEN

- Random message group ID for ordered workflows.
- One global message group ID for high-throughput workflows unless strictly required.
- Relying on FIFO deduplication as business idempotency substitute.

## 8. Subscription and Filter Policy Rules

### MUST

- Treat subscription filter policy as contract.
- Test filter policy with representative messages.
- Keep filter attributes stable and documented.
- Use DLQ/retry behavior for critical subscriptions where supported.

### FORBIDDEN

- Changing filter attribute names without subscriber migration plan.
- Filtering on untrusted arbitrary user fields.
- Assuming every subscriber receives every message after filters are introduced.

## 9. Error Handling and Retry Rules

### MUST

- Distinguish throttling, authorization failure, validation failure, endpoint disabled, timeout, and AWS service failure.
- Retry only with idempotency behavior defined.
- If publish succeeds but downstream processing fails, recovery belongs to subscriber/DLQ/replay mechanism.

### FORBIDDEN

- Swallowing publish failure and marking business transaction complete unless outbox/reconciliation exists.
- Blind retry of publish with new event IDs.

## 10. Outbox Rule

### MUST

Use an outbox pattern when SNS publish is part of a database transaction that must not be lost.

The outbox record MUST include:

- event ID;
- aggregate type and ID;
- event type;
- version;
- payload;
- topic logical name;
- publish status;
- attempt count;
- last error.

### FORBIDDEN

- Database commit followed by best-effort publish with no recovery for critical events.

## 11. Security Rules

### MUST

- Use least-privilege `sns:Publish` to exact topic ARN.
- Use topic policy to constrain publishers/subscribers.
- Validate cross-account publish/subscription explicitly.
- Redact payload in logs.

### FORBIDDEN

- Runtime role with `sns:*`.
- Public publish/subscribe topic policy unless explicitly intended.

## 12. Testing Rules

### MUST

- Test payload schema, attributes, topic ARN resolution, FIFO group/dedup IDs, error mapping, and outbox retry.
- Test filter policy contract if managed in application/infrastructure.
- Test that sensitive fields are redacted.

### FORBIDDEN

- Tests publishing to production topic.
- Tests depending on email/SMS external delivery timing.

## 13. Reviewer Checklist

- [ ] topic type standard/FIFO declared.
- [ ] schema/version declared.
- [ ] idempotency/dedup strategy present.
- [ ] attributes safe and stable.
- [ ] outbox used for critical DB-to-SNS workflows.
- [ ] IAM least privilege.
- [ ] tests cover publish failure and duplicate delivery.

## 14. LLM Prompt Contract

For SNS code, the LLM MUST state:

- topic ARN source;
- standard vs FIFO;
- message schema/version;
- attributes/filter policy;
- dedup/idempotency behavior;
- outbox/recovery plan;
- IAM policy actions/resources;
- tests.

## Source Anchors

- SNS examples with AWS SDK for Java 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_sns_code_examples.html
- Work with SNS using AWS SDK for Java 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/examples-simple-notification-service.html

## Source Anchors

- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x default credentials provider chain: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html
- AWS SDK retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x pagination: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/pagination.html
- AWS Java SDK 1.x end-of-support announcement: https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-java-v1-x-on-december-31-2025/
