# Strict Coding Standards — Go AWS SNS

> Purpose: mandatory coding standard for LLM/code-agent generated Go code.
> Scope: implementation, refactoring, testing, code review, and production hardening.
> Rule language: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.
> Default SDK: AWS SDK for Go v2 only, unless a project explicitly approves otherwise.

This standard governs Go code that publishes to, manages, or consumes delivery semantics from Amazon SNS topics using AWS SDK for Go v2.

## Source Authority

Use these sources as the primary authority when resolving ambiguity:

- AWS SDK for Go v2 Developer Guide: configuration, authentication, retries, timeouts, examples.
- AWS SDK for Go v2 package docs on pkg.go.dev for service clients and operation types.
- AWS service developer guides and API references for service-specific semantics.
- Go official docs for `context`, `net/http`, `io`, `log/slog`, testing, race detector, and modules.
- Project-specific architecture/security standards when stricter than AWS or Go defaults.

When these sources conflict, apply the stricter production-safe rule unless the project owner records an exception.

## Non-Negotiable Rules

1. Use `github.com/aws/aws-sdk-go-v2/service/sns`.
2. Topic ARN **MUST** be config-owned or allowlisted; user input **MUST NOT** select arbitrary topic ARN.
3. Published messages **MUST** use explicit event envelope/versioning for application events.
4. Message attributes **MUST** be allowlisted and cardinality-controlled.
5. FIFO topics **MUST** provide explicit `MessageGroupId` and `MessageDeduplicationId` unless content-based deduplication is deliberately enabled and documented.
6. Publish operations **MUST** be idempotency-aware.
7. Raw PII/secrets **MUST NOT** be placed in SNS messages unless explicitly approved by data classification and encryption policy.
8. SNS delivery is asynchronous; application code **MUST NOT** treat successful publish as subscriber processing success.
9. Publish errors **MUST** be classified and wrapped.
10. Tests **MUST** cover message shape, attributes, FIFO fields, and retry/idempotency behavior.

## Client Boundary

```go
type SNSPublisher interface {
    Publish(ctx context.Context, params *sns.PublishInput, optFns ...func(*sns.Options)) (*sns.PublishOutput, error)
}

type EventPublisher struct {
    client   SNSPublisher
    topicARN string
}
```

Rules:

- Keep SNS client behind an application-specific publisher.
- Do not expose AWS-specific topic ARN to domain logic.
- Domain/application code should emit domain events; infrastructure maps them to SNS payloads.

## Message Envelope

Application event messages **MUST** have a stable envelope:

```json
{
  "event_id": "uuid-or-domain-idempotency-key",
  "event_type": "CaseEscalated",
  "event_version": 1,
  "occurred_at": "2026-06-10T12:00:00Z",
  "producer": "case-service",
  "tenant_id": "...",
  "correlation_id": "...",
  "payload": {}
}
```

Rules:

- `event_id` **MUST** be stable for retries of the same event.
- `event_type` and `event_version` **MUST** be explicit.
- `occurred_at` **MUST** use RFC3339 UTC timestamp.
- `payload` **MUST** be schema-controlled.
- Unknown/experimental event fields **MUST** be documented before publishing.

## Publish Rules

Preferred pattern:

```go
func (p *EventPublisher) PublishCaseEscalated(ctx context.Context, evt CaseEscalatedEvent) error {
    if err := evt.Validate(); err != nil {
        return err
    }
    body, err := json.Marshal(evt)
    if err != nil {
        return fmt.Errorf("marshal case escalated event: %w", err)
    }

    _, err = p.client.Publish(ctx, &sns.PublishInput{
        TopicArn: aws.String(p.topicARN),
        Message:  aws.String(string(body)),
        MessageAttributes: map[string]types.MessageAttributeValue{
            "event_type": {
                DataType:    aws.String("String"),
                StringValue: aws.String("CaseEscalated"),
            },
            "event_version": {
                DataType:    aws.String("Number"),
                StringValue: aws.String("1"),
            },
        },
    })
    if err != nil {
        return fmt.Errorf("publish case escalated event: %w", err)
    }
    return nil
}
```

Rules:

- Do not build JSON messages through string concatenation.
- Do not publish raw Go structs through `%v` or `fmt.Sprint`.
- Validate message size before publish when payload may grow.
- Large payloads **SHOULD** use claim-check pattern with S3 reference after security review.

## FIFO Topic Rules

Rules:

- FIFO topic publish **MUST** set `MessageGroupId` based on ordering boundary.
- `MessageGroupId` **MUST NOT** be a constant for all messages unless global serialization is intended.
- `MessageDeduplicationId` **MUST** be stable for retries of the same logical event.
- Deduplication ID **MUST NOT** be random per retry.
- Ordering boundary **MUST** be documented, e.g. `case_id`, `account_id`, `tenant_id`.

Preferred:

```go
input.MessageGroupId = aws.String(evt.CaseID)
input.MessageDeduplicationId = aws.String(evt.EventID)
```

Forbidden:

```go
input.MessageDeduplicationId = aws.String(uuid.NewString()) // BAD for retry deduplication
```

## Message Attributes

Rules:

- Attributes **MUST** be used for routing/filtering metadata only.
- Do not place confidential payload in attributes.
- Attribute names **MUST** be stable and documented.
- Attribute cardinality **MUST** be controlled; avoid raw user IDs as filter attributes unless justified.
- Attribute type **MUST** match SNS contract: String, Number, Binary, or arrays where supported by policy.

Recommended attributes:

- `event_type`
- `event_version`
- `producer`
- `tenant_class` or controlled tenant group, not arbitrary tenant ID unless required
- `schema`

## Delivery Semantics and Idempotency

Rules:

- Subscribers may receive duplicates; events **MUST** include idempotency keys.
- Successful publish only means SNS accepted the message.
- Producer **MUST** persist outbox or equivalent before/with publish when losing events is unacceptable.
- Consumer design **MUST** be idempotent.
- Publish retries **MUST** not produce distinct logical events.

## Security

Rules:

- Topic policy **MUST** restrict publishers/subscribers.
- Cross-account publish/subscribe **MUST** be explicit.
- KMS encryption **SHOULD** be enabled for sensitive messages.
- Messages **MUST NOT** include secrets.
- Logs **MUST NOT** include full message body for sensitive events.

## Testing

Required tests:

- Event envelope has required fields.
- JSON schema/backward compatibility is preserved.
- Attributes are allowlisted.
- FIFO group/dedup IDs are stable and correct.
- Error wrapping includes operation but not raw payload.
- Publish uses caller context.
- Duplicate publish retry uses same event ID.

## Anti-Patterns

Forbidden:

```go
_, _ = client.Publish(context.Background(), &sns.PublishInput{
    TopicArn: aws.String(topicFromRequest),
    Message:  aws.String(fmt.Sprint(payload)),
})
```

```go
slog.Info("sns publish", "message", messageJSON) // BAD for sensitive payload
```

## Merge Checklist

- [ ] Topic ARN is config-owned.
- [ ] Message envelope is versioned.
- [ ] Payload is schema-controlled.
- [ ] Message attributes are allowlisted.
- [ ] FIFO ordering/dedup behavior is correct if used.
- [ ] Publish is idempotency-aware.
- [ ] Sensitive content is not logged.
- [ ] Tests cover success, failure, retry, and malformed event.
