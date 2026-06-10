# Strict Coding Standards: Java + AWS SQS

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

This file defines strict rules for Java code that sends, receives, deletes, extends visibility, redrives, or observes Amazon SQS messages.

It applies to:

- `SqsClient`;
- standard queues;
- FIFO queues;
- long polling;
- visibility timeout;
- DLQ/redrive;
- batch send/receive/delete;
- idempotent consumers;
- outbox/inbox patterns.

## 3. SQS Usage Model

### MUST

- Use SQS as a durable queue/buffer between producers and consumers.
- Define queue type: standard or FIFO.
- Treat delivery as at-least-once for consumer design.
- Make consumers idempotent.
- Define poison-message handling.
- Define message retention and DLQ policy in infrastructure.

### FORBIDDEN

- Assuming exactly-once side effects.
- Using queue as a database.
- Using SQS as low-latency RPC.

## 4. Client and Dependency Rules

### MUST

- Use AWS SDK for Java 2.x.
- Reuse `SqsClient`.
- Configure timeout, retry, region, credentials, and HTTP client.
- Wrap send/receive/delete in queue-specific adapters.

### FORBIDDEN

- Creating client per message.
- Hardcoding queue URL in business logic.
- Domain layer directly depending on AWS SDK classes.

## 5. Message Contract

### MUST

- Define message type, version, producer, schema, and compatibility rule.
- Include message ID or event ID controlled by producer.
- Include correlation/trace context when safe.
- Use attributes for routing/metadata only.
- Bound message size and reject oversized payloads early.

### FORBIDDEN

- Java native serialization.
- Unversioned JSON.
- Secrets in message attributes or logs.
- Payloads whose interpretation depends on local JVM class names.

## 6. Sending Rules

### MUST

- Use FIFO queue only when ordering/dedup requirements justify it.
- For FIFO, set `MessageGroupId` deliberately.
- For FIFO, set `MessageDeduplicationId` or document content-based deduplication.
- Use batch send only with partial failure handling.
- Use outbox when DB commit and queue send must be recoverable.

### FORBIDDEN

- Random FIFO group ID for ordered workflows.
- One global FIFO group ID unless ordering across all messages is truly required.
- Treating successful batch call as success for every entry without checking result entries.

## 7. Receiving Rules

### MUST

- Use long polling where appropriate.
- Configure max messages, wait time, and visibility timeout intentionally.
- Delete message only after successful processing and durable side effects.
- Change/extend visibility timeout for long-running processing.
- Handle empty receives without busy-looping.
- Use bounded worker concurrency.

### FORBIDDEN

- Auto-delete before processing.
- Infinite processing without visibility extension.
- Unbounded local queue between receiver and workers.
- `while(true)` polling without sleep/backoff/shutdown.

## 8. Visibility Timeout Rules

### MUST

- Set visibility timeout according to processing time plus margin.
- Extend visibility for long tasks using heartbeat/lease pattern.
- Keep task idempotent because visibility timeout expiry causes redelivery.
- Emit metrics for visibility extension and processing latency.

### FORBIDDEN

- Assuming visibility timeout prevents duplicates.
- Setting huge visibility timeout to hide failed messages indefinitely.

## 9. DLQ and Redrive Rules

### MUST

- Configure DLQ for queues with poison-message risk.
- Define `maxReceiveCount` deliberately.
- Include message type, version, error category, and trace ID in logs when a message is moved or abandoned.
- Provide replay/redrive runbook.

### FORBIDDEN

- Dropping poison messages silently.
- Redriving DLQ blindly without fixing root cause.
- Using DLQ with FIFO workflows without evaluating ordering impact.

## 10. Consumer Idempotency Rules

### MUST

- Identify idempotency key: event ID, command ID, aggregate/version, or message dedup ID.
- Store processed IDs or use conditional writes where side effects are non-idempotent.
- Make delete-after-processing safe when processing result already committed.

### FORBIDDEN

- Relying only on SQS message ID for business idempotency when producer can send duplicates.
- Re-executing irreversible side effects on duplicate message.

## 11. Error Handling Rules

### MUST

- Classify errors as retryable, non-retryable, poison, throttling, timeout, permission, malformed payload, and dependency failure.
- Do not delete retryable-failed messages unless sent to explicit DLQ/retry queue.
- Delete or quarantine malformed non-retryable messages according to policy.

### FORBIDDEN

- Catching all exceptions and deleting message.
- Logging full payload on failure.

## 12. Security Rules

### MUST

- Use least-privilege `sqs:SendMessage`, `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, and related actions only where required.
- Scope runtime role to exact queue ARN.
- Use encryption policy according to data classification.
- Avoid secrets in payload.

### FORBIDDEN

- Runtime role with `sqs:*`.
- Public queue policy unless explicitly intended.

## 13. Testing Rules

### MUST

- Test send failure, receive empty, processing success, processing retry, visibility extension, duplicate message, malformed payload, DLQ behavior, and batch partial failure.
- Test graceful shutdown without losing in-flight work.
- Test idempotent consumer behavior.

### FORBIDDEN

- Tests polling production queue.
- Tests assuming real SQS delivery timing is deterministic.

## 14. Reviewer Checklist

- [ ] queue type declared.
- [ ] visibility timeout and long polling configured.
- [ ] consumer idempotency implemented.
- [ ] delete-after-success only.
- [ ] DLQ/redrive policy defined.
- [ ] batch partial failure handled.
- [ ] outbox used for critical DB-to-SQS workflows.
- [ ] IAM least privilege.
- [ ] payload redacted in logs.

## 15. LLM Prompt Contract

For SQS code, the LLM MUST state:

- queue URL source;
- standard vs FIFO;
- message schema/version;
- visibility timeout;
- polling/concurrency design;
- idempotency key;
- DLQ/redrive behavior;
- IAM actions/resources;
- tests.

## Source Anchors

- SQS examples with AWS SDK for Java 2.x: https://docs.aws.amazon.com/code-library/latest/ug/java_2_sqs_code_examples.html
- SQS visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- SQS dead-letter queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html

## Source Anchors

- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x default credentials provider chain: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html
- AWS SDK retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x pagination: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/pagination.html
- AWS Java SDK 1.x end-of-support announcement: https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-java-v1-x-on-december-31-2025/
