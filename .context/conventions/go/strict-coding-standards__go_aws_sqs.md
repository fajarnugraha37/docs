# Strict Coding Standards — Go AWS SQS

> Purpose: mandatory coding standard for LLM/code-agent generated Go code.
> Scope: implementation, refactoring, testing, code review, and production hardening.
> Rule language: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
> Default SDK: AWS SDK for Go v2 only, unless a project explicitly approves otherwise.

This standard governs Go code that sends, receives, deletes, extends, or processes messages from Amazon SQS queues.

## Source Authority

Use these sources as the primary authority when resolving ambiguity:

- AWS SDK for Go v2 Developer Guide: configuration, authentication, retries, timeouts, examples.
- AWS SDK for Go v2 package docs on pkg.go.dev for service clients and operation types.
- AWS service developer guides and API references for service-specific semantics.
- Go official docs for `context`, `net/http`, `io`, `log/slog`, testing, race detector, and modules.
- Project-specific architecture/security standards when stricter than AWS or Go defaults.

When these sources conflict, apply the stricter production-safe rule unless the project owner records an exception.

## Non-Negotiable Rules

1. Use `github.com/aws/aws-sdk-go-v2/service/sqs`.
2. Queue URL/ARN **MUST** be config-owned or allowlisted.
3. Consumers **MUST** assume at-least-once delivery and design idempotent processing.
4. Every received message **MUST** be deleted only after successful processing and durable side effects.
5. Visibility timeout **MUST** be aligned with processing time and extended for long-running work.
6. Long polling **SHOULD** be used for consumers unless there is a specific reason not to.
7. Message body **MUST** be schema-versioned and validated before processing.
8. DLQ behavior **MUST** be defined for poison messages.
9. FIFO queues **MUST** set and preserve `MessageGroupId` and deduplication semantics deliberately.
10. Consumers **MUST** handle partial batch success/failure and shutdown safely.

## Client Boundary

```go
type SQSClient interface {
    SendMessage(ctx context.Context, params *sqs.SendMessageInput, optFns ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
    ReceiveMessage(ctx context.Context, params *sqs.ReceiveMessageInput, optFns ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error)
    DeleteMessage(ctx context.Context, params *sqs.DeleteMessageInput, optFns ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error)
    ChangeMessageVisibility(ctx context.Context, params *sqs.ChangeMessageVisibilityInput, optFns ...func(*sqs.Options)) (*sqs.ChangeMessageVisibilityOutput, error)
}
```

Rules:

- Keep queue URL out of domain logic.
- Do not expose receipt handles outside consumer infrastructure.
- Do not store receipt handles durably unless a specific recovery protocol is designed.

## Message Envelope

```json
{
  "message_id": "logical-idempotency-key",
  "message_type": "GenerateReport",
  "message_version": 1,
  "created_at": "2026-06-10T12:00:00Z",
  "correlation_id": "...",
  "tenant_id": "...",
  "payload": {}
}
```

Rules:

- `message_id` **MUST** be stable across send retries for same logical message.
- `message_type` and `message_version` **MUST** be explicit.
- `payload` **MUST** be validated before side effects.
- Message size **MUST** be checked before send.

## SendMessage Rules

Preferred:

```go
_, err := q.client.SendMessage(ctx, &sqs.SendMessageInput{
    QueueUrl:    aws.String(q.queueURL),
    MessageBody: aws.String(body),
    MessageAttributes: map[string]types.MessageAttributeValue{
        "message_type": {
            DataType:    aws.String("String"),
            StringValue: aws.String("GenerateReport"),
        },
    },
})
if err != nil {
    return fmt.Errorf("send sqs message type=%s: %w", msg.Type, err)
}
```

Rules:

- Queue URL **MUST** come from config.
- Message attributes **MUST** be allowlisted.
- Delay seconds **MUST** be deliberate and bounded.
- Do not send raw user-supplied JSON without validation/envelope.
- For FIFO queues, `MessageGroupId` **MUST** be set and deduplication ID **MUST** be stable.

## Receive Loop Rules

Rules:

- Use long polling with `WaitTimeSeconds` where appropriate.
- Set `MaxNumberOfMessages` based on worker/concurrency capacity.
- Use context cancellation to stop polling.
- Do not spawn unbounded goroutines per message.
- Backpressure **MUST** exist between polling and workers.
- Handle empty receives without busy-looping.

Preferred structure:

```go
func (c *Consumer) Run(ctx context.Context) error {
    for ctx.Err() == nil {
        out, err := c.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
            QueueUrl:            aws.String(c.queueURL),
            MaxNumberOfMessages: c.maxBatch,
            WaitTimeSeconds:     c.waitSeconds,
            VisibilityTimeout:   c.visibilitySeconds,
            MessageAttributeNames: []string{"All"},
        })
        if err != nil {
            if ctx.Err() != nil {
                return ctx.Err()
            }
            c.recordReceiveError(err)
            continue
        }
        c.dispatch(ctx, out.Messages)
    }
    return ctx.Err()
}
```

## Processing and Delete Rules

Rules:

- Delete message only after successful processing.
- If processing fails, do not delete; rely on visibility timeout and DLQ/redrive policy.
- For known permanent validation errors, either delete and write to an application dead-letter store or allow DLQ after max receives, based on runbook.
- Processing **MUST** be idempotent by `message_id` or domain idempotency key.
- Side effects **MUST** be ordered before delete.

Preferred:

```go
if err := handler.Handle(ctx, msg); err != nil {
    return fmt.Errorf("handle message id=%s: %w", safeID(msgID), err)
}
_, err := client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
    QueueUrl:      aws.String(queueURL),
    ReceiptHandle: msg.ReceiptHandle,
})
```

## Visibility Timeout and Heartbeat

Rules:

- Visibility timeout starts when a message is delivered and must cover processing plus delete latency.
- Long-running processing **MUST** extend visibility before expiry.
- Visibility extension **MUST** stop after processing finishes or context is cancelled.
- Extension failure **MUST** be logged and classified because duplicate processing may occur.
- Do not set very long visibility timeout to hide stuck processing; use heartbeat and observability.

## DLQ and Poison Messages

Rules:

- Queue redrive policy **MUST** be documented.
- Poison message handling **MUST** preserve enough context to debug without exposing secrets.
- DLQ replay **MUST** be explicit and audited.
- FIFO queues and DLQs **MUST** be reviewed carefully because DLQ movement can affect strict ordering semantics.

## FIFO Queue Rules

Rules:

- `MessageGroupId` **MUST** represent the required ordering boundary.
- Do not use one global group unless serial processing is intended.
- `MessageDeduplicationId` **MUST** be stable for retry of the same message.
- Consumers **MUST** be idempotent even with FIFO because exactly-once business side effects are not guaranteed.

## Batch Processing

Rules:

- Batch receive does not imply all messages succeed/fail together.
- Delete successes individually or batch-delete only successfully processed messages.
- Batch delete result **MUST** inspect failed entries.
- Partial failure **MUST** be reported in metrics.

## Testing

Required tests:

- Receive loop stops on context cancellation.
- Message is deleted only after handler success.
- Handler failure does not delete.
- Invalid message schema follows poison policy.
- Visibility extension is invoked for long work.
- FIFO message group/dedup IDs are stable.
- Batch delete handles partial failure.
- Duplicate delivery is idempotent.

## Anti-Patterns

Forbidden:

```go
// BAD: deletes before durable side effects.
_, _ = client.DeleteMessage(ctx, deleteInput)
err := handler.Handle(ctx, msg)
```

```go
// BAD: unbounded goroutine per receive forever.
go process(msg)
```

```go
// BAD: random dedup id breaks retry deduplication.
MessageDeduplicationId: aws.String(uuid.NewString())
```

## Merge Checklist

- [ ] Queue URL is config-owned.
- [ ] Message envelope is versioned.
- [ ] Long polling/backpressure are used.
- [ ] Processing is idempotent.
- [ ] Delete happens only after success.
- [ ] Visibility timeout/extension is designed.
- [ ] DLQ/redrive policy is documented.
- [ ] FIFO semantics are correct if used.
- [ ] Tests cover duplicate, failure, cancellation, and partial batch cases.
