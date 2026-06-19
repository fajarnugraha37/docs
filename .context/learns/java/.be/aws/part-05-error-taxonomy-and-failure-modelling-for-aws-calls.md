# Part 5 — Error Taxonomy and Failure Modelling for AWS Calls

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-05-error-taxonomy-and-failure-modelling-for-aws-calls.md`  
Scope: Java 8–25, AWS SDK for Java 2.x, Lambda, S3, SQS, SNS, Secrets Manager, SSM, STS, KMS, EventBridge, CloudWatch, and production-grade cloud integration.

---

## 0. Why This Part Matters

A normal developer asks:

> “What exception should I catch?”

A stronger engineer asks:

> “What failure state did the system enter, what invariant may have been broken, and what recovery action is safe?”

That is the real focus of this part.

AWS calls are not local method calls. Every AWS SDK call crosses several boundaries:

```text
Java code
  -> AWS SDK request pipeline
  -> credentials provider
  -> endpoint resolution
  -> HTTP client / TLS / DNS / TCP
  -> AWS front-end service
  -> AWS internal control plane or data plane
  -> service-specific authorization, validation, throttling, execution
  -> response marshalling
  -> Java response or exception
```

Any layer can fail. The same Java statement can fail because:

- your code built an invalid request,
- the SDK could not obtain credentials,
- DNS failed,
- TLS failed,
- the HTTP connection pool was exhausted,
- AWS rejected the request due to IAM,
- AWS throttled the request,
- the target resource does not exist,
- the service accepted the write but the client timed out before receiving the response,
- an event was delivered more than once,
- a batch partially succeeded,
- a retry caused duplicate side effects,
- a downstream dependency became unavailable,
- or the system is overloaded and your retry policy made it worse.

The purpose of this chapter is to build a mental model that lets you decide correctly under ambiguity.

AWS SDK for Java 2.x documents two major exception families: `AwsServiceException`, where the AWS service returned an error response, and `SdkClientException`, where the SDK/client side could not complete the call or parse the response. AWS SDK retries some failures according to its retry strategy, but not every failure is retryable, and application-level safety still belongs to your design. See AWS SDK for Java 2.x error handling and retry strategy documentation for the official baseline. [1][2]

---

## 1. Core Mental Model: An AWS Error Is Not One Thing

When an AWS call fails, do not classify it first by Java exception class. Classify it by **system meaning**.

A useful top-level taxonomy:

```text
AWS call failure
├── 1. Local construction/configuration failure
├── 2. Credential and identity failure
├── 3. Client transport failure
├── 4. AWS service rejection
├── 5. AWS service transient failure
├── 6. Throttling / quota / load-shed failure
├── 7. Ambiguous completion failure
├── 8. Partial success failure
├── 9. Duplicate / replay / out-of-order failure
├── 10. Domain invariant failure
└── 11. Operational unknown failure
```

These categories matter because each one needs different handling.

Example:

| Category | Example | Correct Response |
|---|---|---|
| Local construction failure | Missing bucket name, invalid ARN, null required field | fail fast, fix code/config |
| Credential failure | expired token, missing role, wrong profile | fail fast or refresh credentials |
| Transport failure | DNS/TCP/TLS/socket timeout | retry if safe and budget remains |
| Service rejection | AccessDenied, ValidationException | usually fail fast |
| Transient service failure | 500, 503 | retry with backoff/jitter |
| Throttling | TooManyRequests, ThrottlingException, SlowDown | slow down, retry with backoff, reduce concurrency |
| Ambiguous completion | write timed out after reaching AWS | retry only if idempotent or deduplicated |
| Partial success | batch SQS delete partly failed | reconcile item by item |
| Duplicate/replay | SQS message delivered twice | idempotent consumer |
| Domain invariant failure | approve already closed case | reject or compensate |
| Unknown | unexpected SDK/runtime behavior | safe fallback, alert, preserve evidence |

Top-tier engineers do not treat all exceptions as “retryable errors”. They ask:

1. Was the request sent?
2. Did AWS receive it?
3. Did AWS execute it?
4. Did the client receive the result?
5. Is repeating the request safe?
6. Could the failure have already produced a side effect?
7. What invariant must be preserved?
8. What evidence do we need for operations and audit?

---

## 2. The Three Outcomes of a Remote Call

A local method call usually has two obvious outcomes:

```text
return value
exception
```

A remote call has at least three:

```text
1. Confirmed success
2. Confirmed failure
3. Unknown / ambiguous completion
```

The third is the dangerous one.

Example:

```java
s3.putObject(request, requestBody);
```

If this times out, what happened?

Possibilities:

```text
A. Request never left the JVM.
B. Request left JVM but never reached AWS.
C. AWS received the request but rejected it.
D. AWS received and completed the write, but response was lost.
E. AWS completed the write, client timed out, SDK retried, second attempt overwrote same key.
```

A beginner sees a timeout as “failed”. A senior engineer sees it as “unknown until reconciled”.

This distinction changes the design.

For **read-only operations**, retry is usually safe:

```text
GetSecretValue
GetParameter
HeadObject
GetObject
ReceiveMessage, with caveats
Describe*
List*, with pagination caveats
```

For **write operations**, retry safety depends on idempotency:

```text
PutObject to deterministic key                 often safe, if overwrite semantics intended
PutObject to random key                        risky, can create duplicates
SendMessage without deduplication              risky, can duplicate work
Publish SNS                                    risky, can duplicate notifications/events
StartExecution / Create*                       depends on client token/name uniqueness
DeleteObject                                   usually idempotent-ish but versioning changes semantics
UpdateSecret                                   depends on version and staging labels
```

AWS APIs vary. Some APIs support explicit client tokens for idempotency. AWS documentation commonly describes client tokens as unique, case-sensitive identifiers used to ensure idempotent API requests; repeated retries with the same token can return the original successful result without additional side effects for APIs that support the feature. [7]

Your application must know which semantic bucket an operation belongs to.

---

## 3. SDK Exception Model in Java 2.x

AWS SDK for Java 2.x uses unchecked exceptions. The important families are:

```text
RuntimeException
└── SdkException
    ├── SdkClientException
    └── SdkServiceException
        └── AwsServiceException
            ├── S3Exception
            ├── SqsException
            ├── SnsException
            ├── SecretsManagerException
            ├── SsmException
            ├── KmsException
            ├── StsException
            └── ... service-specific exceptions
```

The official distinction:

- `AwsServiceException`: request reached AWS service and AWS returned an error response.
- `SdkClientException`: client-side issue; the SDK could not contact the service, could not obtain/parse a response, or failed before a service response was available. [1][8]

That distinction is useful, but not sufficient.

### 3.1 `AwsServiceException`

An `AwsServiceException` means AWS responded with an error. It usually contains:

```java
String message = e.getMessage();
String requestId = e.requestId();
int statusCode = e.statusCode();
String errorCode = e.awsErrorDetails().errorCode();
String serviceName = e.awsErrorDetails().serviceName();
```

Typical handling shape:

```java
try {
    s3.headObject(builder -> builder.bucket(bucket).key(key));
} catch (S3Exception e) {
    int status = e.statusCode();
    String code = e.awsErrorDetails() == null ? null : e.awsErrorDetails().errorCode();

    if (status == 404 || "NoSuchKey".equals(code)) {
        // Domain-relevant absence.
        return false;
    }

    if (status == 403 || "AccessDenied".equals(code)) {
        // Usually not retryable. Security/config issue.
        throw new DependencyAuthorizationException("S3 access denied", e);
    }

    if (status == 429 || "SlowDown".equals(code) || "ThrottlingException".equals(code)) {
        // Maybe retryable, but only according to budget and idempotency.
        throw new DependencyThrottledException("S3 throttled", e);
    }

    if (status >= 500) {
        throw new DependencyTransientException("S3 transient error", e);
    }

    throw new DependencyRejectedException("S3 rejected request", e);
}
```

Do not just log `e.getMessage()`. Preserve request ID, status code, service name, and error code.

### 3.2 `SdkClientException`

An `SdkClientException` often means the request did not produce a usable AWS service response.

Examples:

- DNS failure
- connect timeout
- socket timeout
- TLS handshake failure
- connection acquisition timeout
- credentials provider failure
- endpoint resolution failure
- response parsing failure
- local IO failure while streaming body

Typical handling:

```java
try {
    secretsManager.getSecretValue(r -> r.secretId(secretId));
} catch (SdkClientException e) {
    // This is not automatically safe to retry at application level.
    // Decide based on operation semantics, retry budget, and ambiguity.
    throw new DependencyTransportException("Could not complete Secrets Manager call", e);
}
```

Subtle point: for a write operation, `SdkClientException` may be ambiguous. If the timeout happened after the request reached AWS, the operation may have succeeded.

### 3.3 Service-Specific Exceptions

Prefer catching service-specific exceptions when the service meaning matters.

Example:

```java
try {
    sqs.sendMessage(request);
} catch (SqsException e) {
    // Can inspect SQS-specific error code/status.
}
```

But avoid scattering service exception handling everywhere. In production Java systems, it is better to centralize translation:

```text
AWS SDK exception
  -> infrastructure dependency exception
  -> application service decision
  -> domain outcome / retry / DLQ / alert
```

Example domain-oriented exception hierarchy:

```java
public abstract class AwsDependencyException extends RuntimeException {
    private final String service;
    private final String operation;
    private final String requestId;
    private final Integer statusCode;
    private final String awsErrorCode;
    private final FailureKind failureKind;

    protected AwsDependencyException(
            String message,
            Throwable cause,
            String service,
            String operation,
            String requestId,
            Integer statusCode,
            String awsErrorCode,
            FailureKind failureKind) {
        super(message, cause);
        this.service = service;
        this.operation = operation;
        this.requestId = requestId;
        this.statusCode = statusCode;
        this.awsErrorCode = awsErrorCode;
        this.failureKind = failureKind;
    }
}
```

Where:

```java
public enum FailureKind {
    VALIDATION,
    AUTHENTICATION,
    AUTHORIZATION,
    NOT_FOUND,
    CONFLICT,
    THROTTLING,
    TRANSIENT_SERVICE,
    TRANSPORT,
    TIMEOUT,
    AMBIGUOUS_COMPLETION,
    PARTIAL_SUCCESS,
    UNKNOWN
}
```

The goal is not to wrap exceptions for fun. The goal is to make upper layers reason in terms of **failure meaning**, not SDK internals.

---

## 4. HTTP Status Codes Are Not Enough

HTTP status code is useful, but AWS service error code is often more precise.

Example groups:

```text
400 Bad Request
  - ValidationException
  - InvalidParameterValue
  - MissingParameter
  - RequestTimeTooSkewed
  - ThrottlingException, in some services

403 Forbidden
  - AccessDenied
  - AccessDeniedException
  - ExpiredToken
  - SignatureDoesNotMatch
  - KMSAccessDeniedException

404 Not Found
  - NoSuchBucket
  - NoSuchKey
  - ResourceNotFoundException
  - ParameterNotFound
  - SecretNotFound

409 Conflict
  - ResourceAlreadyExistsException
  - ConditionalCheckFailedException
  - OperationAborted

429 Too Many Requests
  - TooManyRequestsException
  - ThrottlingException
  - LimitExceededException

500/503
  - InternalFailure
  - InternalServerError
  - ServiceUnavailable
  - SlowDown, often S3-specific throttling/load signal
```

Do not write code like this as your only classifier:

```java
if (e.statusCode() >= 500) retry();
else fail();
```

Better:

```java
FailureKind kind = classify(e);
Decision decision = policy.decide(operation, kind, idempotency, attemptBudget);
```

Why? Because some AWS throttling errors are 400 or 429, some conflict errors are safe to treat as success in idempotent create flows, and some 404 errors are domain-normal while others indicate environment misconfiguration.

---

## 5. Failure Classification Table

Use this as a starting model.

| Failure | Typical AWS Signal | Retry? | Application Meaning |
|---|---|---:|---|
| Invalid request | `ValidationException`, `InvalidParameter` | No | code/config bug |
| Missing permission | `AccessDenied`, `AccessDeniedException` | No | IAM/policy bug or wrong role |
| Expired credential | `ExpiredToken`, provider exception | Maybe after refresh | identity lifecycle issue |
| Missing resource | `NoSuchKey`, `ResourceNotFoundException` | Usually no | absence or environment drift |
| Already exists | `ResourceAlreadyExistsException`, 409 | Maybe treat as success | idempotent create flow |
| Conflict | `ConflictException`, conditional failure | Usually no | concurrent mutation/domain race |
| Throttling | `ThrottlingException`, `TooManyRequests`, `SlowDown` | Yes, with backoff and reduced concurrency | load control signal |
| Service transient | 500/503 | Yes, bounded | temporary AWS-side issue |
| Transport timeout | `SdkClientException`, timeout cause | Maybe | ambiguous for writes |
| Connection pool exhausted | acquisition timeout | Not blindly | local saturation |
| DNS/TLS failure | client exception | Maybe | network/config/env issue |
| Partial batch failure | batch response entries | Per item | reconcile item-level result |
| Duplicate event | same message/event arrives again | N/A | handler must be idempotent |
| Out-of-order event | older version after newer | N/A | version/transition guard |

---

## 6. Retry Is a Tool, Not a Strategy

A retry means:

> “I am willing to spend more time and capacity because I believe repeating the operation is safe and likely to succeed.”

That sentence has four assumptions:

1. The failure is probably temporary.
2. The operation is safe to repeat.
3. There is enough time budget left.
4. Retrying will not make the system worse.

If any assumption is false, retry is dangerous.

### 6.1 Retryable Does Not Mean Safe

A network timeout may be retryable at transport level, but not safe at business level.

Example:

```text
Operation: publish “Send email to customer” event
Failure: socket timeout after request body was sent
Question: did SNS receive and fan out the message?
```

If you retry blindly, you may send two emails.

Correct approach:

```text
- make event idempotent using business event ID,
- have subscriber dedupe,
- or store outbox event before publish,
- or use FIFO/dedup where applicable,
- or design notification system to collapse duplicates.
```

### 6.2 SDK Retry vs Application Retry

AWS SDK retry handles low-level retry according to configured strategy. AWS SDKs support retry modes such as standard, adaptive, and legacy; SDK for Java 2.x retry strategy documentation describes default attempts and retry behavior. [2][6]

But SDK retry is not enough because it cannot understand your domain invariant.

Example:

```java
caseApprovalPublisher.publish(caseApprovedEvent);
```

The SDK does not know whether duplicate event publication is allowed.

Therefore distinguish:

```text
SDK retry
  small, low-level retry around a single dependency call

Application retry
  retrying a business step, message, job, workflow, or command

Operational replay
  manually or automatically replaying failed events after investigation
```

These must not fight each other.

Bad design:

```text
SDK retry: 3 attempts
SQS redelivery: many attempts
Lambda retry: retries batch
Application retry: internal loop 5 attempts
DLQ redrive: bulk replay
```

This can produce retry amplification.

Top-tier design sets retry ownership clearly.

---

## 7. Retry Budget and Deadline Thinking

A request should have an end-to-end deadline.

Example synchronous API:

```text
Client HTTP timeout: 5 seconds
Controller budget: 4 seconds
Service logic budget: 3 seconds
AWS dependency budget: 1.5 seconds
SDK max attempts: maybe 2
Per-attempt timeout: 500–700 ms
```

If your SDK retry takes 12 seconds inside a 5-second API request, the caller has already gone away. You are just burning capacity.

For async workers, budget is different:

```text
SQS visibility timeout: 120 seconds
Worker per message budget: 90 seconds
AWS call budget: 10 seconds
Batch checkpoint budget: 5 seconds
Shutdown drain budget: 20 seconds
```

Failure modelling requires aligning retries with lifecycle:

| Runtime | Budget Source |
|---|---|
| HTTP API | client timeout / ALB timeout / API Gateway timeout |
| Lambda sync | Lambda timeout / upstream timeout |
| Lambda async | Lambda retry and event age config |
| SQS worker | visibility timeout / retention / max receive count |
| Batch job | schedule window / checkpoint interval |
| Stream consumer | lease timeout / iterator age |

---

## 8. Backoff, Jitter, and Load Shedding

Retry without delay is usually harmful.

Basic progression:

```text
Attempt 1: immediate
Attempt 2: wait 100–300 ms
Attempt 3: wait 500–1000 ms
Attempt 4: wait 2–5 seconds
```

But if many instances retry at the same deterministic interval, they synchronize and create retry storms.

Use jitter.

Mental model:

```text
No jitter:
  1000 clients fail at 10:00:00
  1000 clients retry at 10:00:01
  1000 clients retry at 10:00:03
  service gets hammered in waves

With jitter:
  retry attempts spread over time
  downstream has chance to recover
```

When you see throttling, the correct response is not only “retry later”. It is often:

```text
- reduce concurrency,
- reduce batch size,
- increase polling wait,
- cache reads,
- coalesce writes,
- shard differently,
- request quota increase,
- or move work to queue.
```

AWS SDK adaptive retry mode can adjust delay based on downstream load, but application-level concurrency still matters. [2][6]

---

## 9. Idempotency: The Foundation of Safe Retry

Idempotency means:

> Repeating the same operation produces the same intended effect, not duplicate side effects.

It does not mean “the method returns the same response”. It means the system remains correct after repetition.

### 9.1 Natural Idempotency

Some operations are naturally idempotent if modelled carefully.

```text
PUT object to key: case/123/document/front.pdf
  Same content -> same result
  Different content -> overwrite risk

DELETE object key
  Delete once -> absent
  Delete twice -> still absent, unless versioning changes meaning

Set status to CLOSED
  Repeat set CLOSED -> still CLOSED
```

### 9.2 Idempotency Key

For operations that create side effects, use an idempotency key.

Examples:

```text
caseId + commandId
caseId + eventId
externalRequestId
workflowExecutionId
messageId from upstream plus source system
```

Store result:

```text
idempotency_key
operation_name
status: IN_PROGRESS | SUCCEEDED | FAILED_RETRYABLE | FAILED_FINAL
result_reference
created_at
updated_at
expiry_at
payload_hash
```

Important: store payload hash. If the same idempotency key is reused with different payload, reject it.

```java
public final class IdempotencyRecord {
    private final String key;
    private final String operation;
    private final String payloadSha256;
    private final String status;
    private final String resultReference;
}
```

### 9.3 Idempotent Consumer

For SQS/SNS/EventBridge/Lambda, assume duplicates.

Consumer pattern:

```text
receive event
  -> derive idempotency key
  -> try create processing record
      if already succeeded: ack and exit
      if in progress and not expired: skip/retry later
      if failed retryable: retry according to policy
  -> execute side effect
  -> mark succeeded
  -> ack/delete message
```

Pseudocode:

```java
public void handle(DocumentUploadedEvent event) {
    String key = "document-uploaded:" + event.eventId();
    String hash = sha256(event.canonicalPayload());

    IdempotencyDecision decision = idempotency.begin(key, hash);

    if (decision == IdempotencyDecision.ALREADY_SUCCEEDED) {
        return;
    }

    if (decision == IdempotencyDecision.SAME_KEY_DIFFERENT_PAYLOAD) {
        throw new NonRetryableMessageException("Idempotency key reused with different payload");
    }

    try {
        processDocument(event);
        idempotency.markSucceeded(key, resultReference(event));
    } catch (RetryableException e) {
        idempotency.markRetryableFailure(key, e);
        throw e;
    } catch (Exception e) {
        idempotency.markFinalFailure(key, e);
        throw e;
    }
}
```

### 9.4 Idempotency Is Not Deduplication Only

Deduplication says:

> “I have seen this before.”

Idempotency says:

> “Given I may see this again, the final system state remains correct.”

For example, sending email is not idempotent just because you saw the message before. You need a durable decision record that says whether the email was already sent or a notification request already exists.

---

## 10. Ambiguous Completion

Ambiguous completion is the most important failure class for write operations.

Definition:

> The client cannot tell whether the remote side completed the operation.

Common causes:

```text
- socket timeout after sending request
- connection reset after request body upload
- Lambda timeout after partial side effect
- process killed after AWS call succeeded but before local DB commit
- SQS message processed but delete failed
- SNS publish succeeded but response lost
- S3 multipart upload partly completed
```

### 10.1 Bad Handling

```java
try {
    sns.publish(request);
} catch (SdkClientException e) {
    sns.publish(request); // blind retry
}
```

This may duplicate events.

### 10.2 Better Handling

```text
Option A: make operation idempotent by key
Option B: reconcile state before retry
Option C: write outbox before side effect
Option D: accept duplicate and make downstream idempotent
Option E: fail to repair queue/manual reconciliation
```

### 10.3 Reconciliation Examples

S3 put deterministic object:

```text
If PutObject timed out:
  -> HeadObject key
  -> compare checksum/metadata
  -> if object exists with expected checksum: treat success
  -> if absent: retry
  -> if exists with different checksum: conflict/manual repair
```

SQS delete message failed:

```text
If DeleteMessage failed:
  -> message may reappear after visibility timeout
  -> consumer must be idempotent
  -> do not assume delete failure means processing failure
```

SNS publish failed ambiguously:

```text
If publish event timed out:
  -> cannot query SNS for message existence
  -> use outbox or consumer dedupe
```

Secrets rotation update failed:

```text
If PutSecretValue timed out:
  -> query secret versions/staging labels
  -> verify whether version exists
  -> avoid creating inconsistent AWSCURRENT/AWSPENDING labels
```

---

## 11. Partial Success

Batch APIs are dangerous because the method call can return “success” while individual entries failed.

Examples:

```text
SQS SendMessageBatch
SQS DeleteMessageBatch
SQS ChangeMessageVisibilityBatch
SNS PublishBatch
DynamoDB BatchWriteItem
KMS batch-like app operations
Custom app batch to AWS calls
```

The Java call returning normally does not always mean all items succeeded.

Pattern:

```java
SendMessageBatchResponse response = sqs.sendMessageBatch(request);

for (SendMessageBatchResultEntry ok : response.successful()) {
    markPublished(ok.id(), ok.messageId());
}

for (BatchResultErrorEntry failed : response.failed()) {
    if (Boolean.TRUE.equals(failed.senderFault())) {
        markFinalFailure(failed.id(), failed.code(), failed.message());
    } else {
        scheduleRetry(failed.id(), failed.code(), failed.message());
    }
}
```

Rule:

> Never treat batch-level success as item-level success.

Store per-item outcome.

---

## 12. Service-Specific Failure Mental Models

### 12.1 S3

Common failure classes:

```text
NoSuchBucket
NoSuchKey
AccessDenied
SlowDown
PreconditionFailed
InvalidObjectState
EntityTooLarge
RequestTimeout
KMS-related access denied
```

Important semantics:

- S3 object key design affects overwrite/idempotency.
- `NoSuchKey` may be normal in read-after-delete or optional document flows.
- `AccessDenied` can mean IAM policy, bucket policy, KMS policy, Block Public Access, object ownership, or VPC endpoint policy.
- `SlowDown` means reduce request rate/concurrency.
- Multipart upload can leave incomplete uploads if not aborted.
- Versioning changes delete semantics.

Design rule:

```text
For file-processing systems, never use “upload succeeded” as the only state.
Use object checksum, metadata, processing record, and idempotency key.
```

S3 ambiguous write handling:

```text
PutObject timeout
  -> HeadObject
  -> compare checksum, size, metadata
  -> decide success/retry/conflict
```

### 12.2 SQS

SQS standard queues provide at-least-once delivery, which means consumers must handle duplicate messages. AWS states that a message can occasionally be delivered more than once, so consumers should be idempotent. [4]

Common failure classes:

```text
OverLimit
ReceiptHandleIsInvalid
MessageNotInflight
AWS.SimpleQueueService.NonExistentQueue
AccessDenied
KMSAccessDeniedException
ThrottlingException
```

Important semantics:

- Receive does not remove message.
- Delete requires valid receipt handle.
- Visibility timeout is not a lock forever.
- Message can reappear after timeout.
- Delete failure after processing means duplicate later.
- DLQ is not a fix; it is evidence storage plus recovery queue.
- FIFO ordering is per message group, not global.

Consumer invariant:

```text
A message may be processed zero, one, or many times.
The business side effect must happen exactly as intended.
```

### 12.3 SNS

Common failure classes:

```text
AuthorizationError
NotFound
InvalidParameter
Throttled
EndpointDisabled
KMSAccessDenied
InternalError
```

Important semantics:

- Publish success means SNS accepted the message, not necessarily every subscriber completed business processing.
- Fan-out creates independent subscriber failure paths.
- HTTP/S subscribers have delivery retry policies.
- SNS to SQS gives durable subscriber isolation.
- Publish timeout is ambiguous and difficult to reconcile without outbox/dedupe.

Design rule:

```text
For domain events, use eventId and downstream idempotency.
For commands, model commandId and command result separately.
```

### 12.4 Secrets Manager

Common failure classes:

```text
ResourceNotFoundException
InvalidRequestException
InvalidParameterException
DecryptionFailure
AccessDeniedException
ThrottlingException
InternalServiceError
```

Important semantics:

- Secret not found may mean wrong environment path, not business absence.
- Access denied may come from IAM or KMS.
- Rotation can create temporarily valid multiple versions.
- Client-side caching changes failure behavior: stale secret may be better than hard outage, but dangerous for credential revocation.

Design rule:

```text
Secret read failure should not automatically crash every request if cached safe value exists.
But startup may fail fast if required secret was never loaded.
```

### 12.5 SSM Parameter Store

Common failure classes:

```text
ParameterNotFound
ParameterVersionNotFound
InvalidKeyId
AccessDeniedException
ThrottlingException
InternalServerError
```

Important semantics:

- Config absence usually means deployment/config error.
- SecureString requires KMS access.
- Hierarchical naming mistakes are common.
- High-frequency config reads should be cached.

### 12.6 STS

Common failure classes:

```text
AccessDenied
ExpiredToken
InvalidIdentityToken
MalformedPolicyDocument
PackedPolicyTooLarge
RegionDisabled
ThrottlingException
```

Important semantics:

- STS failure often breaks everything downstream.
- AssumeRole failure is usually identity boundary/config issue, not business error.
- Token refresh races can create intermittent failures.
- Cross-account failures need request IDs and role ARN evidence.

### 12.7 KMS

Common failure classes:

```text
AccessDeniedException
DisabledException
InvalidKeyUsageException
KMSInvalidStateException
NotFoundException
ThrottlingException
DependencyTimeoutException
```

Important semantics:

- KMS failure can surface through S3/SQS/SNS/Secrets, not only direct KMS client calls.
- Key policy and IAM policy both matter.
- Encryption context mismatch causes decrypt failure.
- KMS throttling can become a hidden bottleneck.

Design rule:

```text
When using SSE-KMS, include KMS failure classification in S3/SQS/SNS error handling.
```

### 12.8 Lambda

Lambda error handling depends heavily on invocation mode. For asynchronous invocation, Lambda queues events and retries function errors by default; AWS documents default retries for function errors and separate behavior for throttling/system errors. [9]

For SQS event source mappings, Lambda uses retry/backoff behavior and supports partial batch responses so successfully processed messages do not have to be retried together with failed ones. [5][10]

Important semantics:

```text
Sync invocation
  Caller receives error directly.

Async invocation
  Lambda internal queue + retry + destination/DLQ options.

SQS event source
  Batch retry unless partial batch response is used.

Stream event source
  Ordering/checkpoint semantics matter.
```

Design rule:

```text
A Lambda handler must be designed around the event source failure contract, not around Lambda in general.
```

---

## 13. Decision Matrix: What Should the Application Do?

Use this decision chain.

```text
When AWS call fails:

1. Classify operation
   - read
   - idempotent write
   - non-idempotent write
   - batch
   - workflow step
   - notification/event

2. Classify failure
   - validation/config
   - auth/authz
   - not found
   - conflict
   - throttling
   - transient service
   - transport
   - ambiguous completion
   - partial success
   - duplicate/replay
   - unknown

3. Check budget
   - request deadline
   - Lambda timeout
   - SQS visibility timeout
   - job window
   - retry attempt count

4. Choose action
   - return domain absence
   - fail fast
   - retry with backoff
   - reduce concurrency
   - reconcile
   - compensate
   - defer to queue
   - send to DLQ
   - alert
   - trigger manual repair

5. Preserve evidence
   - service
   - operation
   - request id
   - status code
   - error code
   - correlation id
   - idempotency key
   - resource ARN/key/queue/topic
   - attempt count
```

---

## 14. Fail-Fast vs Retry vs Degrade vs Queue

### 14.1 Fail Fast

Use fail-fast when retry cannot fix the problem.

Examples:

```text
AccessDenied
ValidationException
NoSuchBucket for configured mandatory bucket
ParameterNotFound for required startup config
Malformed ARN
KMS key disabled
```

Fail-fast means:

```text
- stop the current operation,
- surface clear error,
- alert if operationally serious,
- do not burn retries,
- preserve diagnostic evidence.
```

### 14.2 Retry

Use retry when:

```text
- failure is transient,
- operation is safe to repeat,
- budget remains,
- concurrency is controlled,
- retry storm risk is acceptable.
```

Examples:

```text
503 from S3 HeadObject
throttled GetParameter with cache fallback
temporary STS endpoint error
SQS receive transient failure
```

### 14.3 Degrade

Use degrade when dependency failure should not break core behavior.

Examples:

```text
- use stale cached config when SSM unavailable,
- skip non-critical metrics publish,
- queue notification for later,
- return response while async audit pipeline catches up, only if legally acceptable,
- disable optional enrichment.
```

Warning: do not degrade across regulatory/audit-critical boundaries unless the system explicitly records and repairs the missing work.

### 14.4 Queue

Use queue when synchronous call does not need immediate completion.

Examples:

```text
- send email later,
- generate report later,
- virus scan document later,
- sync external system later,
- retry failed integration later.
```

Queueing converts:

```text
caller waiting on dependency
```

into:

```text
durable work item with retry/replay semantics
```

But queueing also introduces:

```text
- duplicate delivery,
- delayed failure visibility,
- DLQ operations,
- eventual consistency,
- state reconciliation.
```

### 14.5 Compensate

Use compensation when a previous side effect succeeded but later step failed.

Example:

```text
1. Upload document to S3 succeeded.
2. Insert metadata DB failed.
3. System now has orphan object.
```

Options:

```text
- delete S3 object if safe,
- mark object quarantine,
- create repair task,
- retry metadata write using object key,
- use outbox/state machine so object is not considered official yet.
```

Compensation is not rollback. It is another business operation that must be audited.

---

## 15. Domain Invariants First

In enterprise/regulatory systems, correctness is not “the AWS call succeeded”. Correctness is preserving domain invariants.

Examples:

```text
A closed case must not be modified by stale async event.
A document must not be marked verified unless scan and officer decision are both recorded.
A notification must not be sent before decision is approved.
An appeal must not transition the original case into invalid state.
An audit event must be reconstructable even if downstream analytics fails.
```

When handling AWS failure, ask:

```text
Which invariant is at risk?
```

Example:

```text
Failure: SNS publish CaseApproved event timed out.
Weak handling: retry publish 5 times.
Better handling:
  - persist domain state transition and outbox event in same DB transaction,
  - publish outbox asynchronously,
  - event has deterministic eventId,
  - subscribers dedupe by eventId,
  - publish failure does not corrupt case state,
  - unpublised outbox row is visible to operations.
```

The invariant is not “SNS publish once”. The invariant is:

```text
Every committed case approval eventually produces one logically unique CaseApproved event, and duplicate physical deliveries do not produce duplicate business effects.
```

---

## 16. Error Handling Architecture in Java

Avoid this pattern:

```java
try {
    awsCall();
} catch (Exception e) {
    log.error("AWS error", e);
    throw e;
}
```

It loses meaning.

A better architecture:

```text
Application service
  -> AWS gateway/adapter
      -> SDK client
      -> exception classifier
      -> retry/idempotency/reconciliation policy
      -> domain/infrastructure exception
  -> application decision
```

### 16.1 Gateway Boundary

Example:

```java
public interface ObjectStorageGateway {
    PutObjectOutcome putDocument(DocumentObject object);
    Optional<DocumentObjectMetadata> findDocument(DocumentObjectKey key);
    DocumentStream openDocument(DocumentObjectKey key);
}
```

Implementation catches AWS details:

```java
public final class S3ObjectStorageGateway implements ObjectStorageGateway {
    private final S3Client s3;
    private final AwsExceptionClassifier classifier;

    @Override
    public Optional<DocumentObjectMetadata> findDocument(DocumentObjectKey key) {
        try {
            HeadObjectResponse response = s3.headObject(r -> r
                    .bucket(key.bucket())
                    .key(key.objectKey()));

            return Optional.of(toMetadata(response));
        } catch (S3Exception e) {
            AwsFailure failure = classifier.classify("s3", "HeadObject", e);
            if (failure.kind() == FailureKind.NOT_FOUND) {
                return Optional.empty();
            }
            throw failure.toException();
        } catch (SdkClientException e) {
            throw classifier.classify("s3", "HeadObject", e).toException();
        }
    }
}
```

Application layer sees:

```java
Optional<DocumentObjectMetadata> metadata = objectStorage.findDocument(key);
```

not AWS exception soup.

### 16.2 Exception Classifier

Sketch:

```java
public final class AwsExceptionClassifier {

    public AwsFailure classify(String service, String operation, Throwable error) {
        if (error instanceof AwsServiceException) {
            return classifyServiceException(service, operation, (AwsServiceException) error);
        }
        if (error instanceof SdkClientException) {
            return classifyClientException(service, operation, (SdkClientException) error);
        }
        return AwsFailure.unknown(service, operation, error);
    }

    private AwsFailure classifyServiceException(
            String service,
            String operation,
            AwsServiceException e) {

        String code = e.awsErrorDetails() == null ? null : e.awsErrorDetails().errorCode();
        int status = e.statusCode();

        if (status == 401 || "UnrecognizedClientException".equals(code) || "InvalidSignatureException".equals(code)) {
            return AwsFailure.authentication(service, operation, e);
        }

        if (status == 403 || containsAny(code, "AccessDenied", "Unauthorized", "Forbidden")) {
            return AwsFailure.authorization(service, operation, e);
        }

        if (status == 404 || containsAny(code, "NotFound", "NoSuchKey", "NoSuchBucket", "ResourceNotFound", "ParameterNotFound")) {
            return AwsFailure.notFound(service, operation, e);
        }

        if (status == 409 || containsAny(code, "Conflict", "AlreadyExists", "ConditionalCheckFailed")) {
            return AwsFailure.conflict(service, operation, e);
        }

        if (status == 429 || containsAny(code, "Throttl", "TooManyRequests", "LimitExceeded", "SlowDown")) {
            return AwsFailure.throttling(service, operation, e);
        }

        if (status >= 500) {
            return AwsFailure.transientService(service, operation, e);
        }

        if (status >= 400) {
            return AwsFailure.rejected(service, operation, e);
        }

        return AwsFailure.unknown(service, operation, e);
    }

    private AwsFailure classifyClientException(
            String service,
            String operation,
            SdkClientException e) {

        if (isTimeout(e)) {
            return AwsFailure.timeout(service, operation, e);
        }
        if (isCredentialFailure(e)) {
            return AwsFailure.authentication(service, operation, e);
        }
        return AwsFailure.transport(service, operation, e);
    }
}
```

This classifier is not perfect. It is a starting point. Real production classifiers evolve from observed incidents.

### 16.3 Policy Layer

Classifier says what happened. Policy says what to do.

```java
public enum FailureAction {
    RETURN_ABSENCE,
    FAIL_FAST,
    RETRY,
    RETRY_AFTER_RECONCILIATION,
    REDUCE_CONCURRENCY,
    DEGRADE,
    SEND_TO_DLQ,
    MANUAL_REPAIR
}
```

Policy input:

```java
public final class FailureDecisionInput {
    private final OperationKind operationKind;
    private final FailureKind failureKind;
    private final boolean idempotent;
    private final int attempt;
    private final Duration remainingBudget;
    private final boolean batch;
    private final boolean domainCritical;
}
```

Decision examples:

```text
Read + transient + budget exists -> retry
Read + not found -> return absence if domain permits
Write non-idempotent + timeout -> reconcile/manual repair/outbox, not blind retry
Authz failure -> fail fast + alert
Throttling + high concurrency -> reduce concurrency + retry with jitter
Batch partial -> item-level retry/failure
```

---

## 17. Mapping Failure to HTTP API Responses

If your Java service exposes REST APIs, do not leak AWS exceptions directly.

Bad:

```json
{
  "message": "software.amazon.awssdk.services.s3.model.S3Exception: Access Denied"
}
```

Better:

```json
{
  "errorCode": "DOCUMENT_STORAGE_UNAVAILABLE",
  "message": "Document storage is temporarily unavailable. Please retry later.",
  "correlationId": "..."
}
```

Mapping example:

| Internal Failure | External API Response |
|---|---|
| AWS `NoSuchKey` for requested document | 404 Document not found |
| S3 `AccessDenied` due to service role bug | 503/500 internal dependency failure, not 403 user forbidden |
| User unauthorized in app domain | 403 user forbidden |
| AWS throttling on optional enrichment | 200 with degraded enrichment or 202 processing |
| AWS transient on required operation | 503 retryable |
| Invalid app request before AWS call | 400 |
| Domain conflict | 409 |

Important: AWS `403 AccessDenied` does not necessarily mean the end user should receive HTTP 403. It may mean your service role lacks permission. That is a server-side dependency/configuration problem.

---

## 18. Mapping Failure to SQS/Lambda Outcomes

For message processing, your outcome is usually:

```text
ack/delete
retry later
send to DLQ eventually
manual quarantine
```

### 18.1 SQS Consumer Decision

```text
If message is invalid forever:
  - record final failure
  - ack/delete message
  - optionally send to invalid-message DLQ/quarantine

If dependency transient:
  - throw / do not delete
  - message returns after visibility timeout

If dependency throttled:
  - slow consumer
  - maybe change visibility
  - retry later

If processing succeeded but delete failed:
  - expect duplicate
  - idempotency handles next delivery
```

### 18.2 Lambda SQS Batch Decision

Without partial batch response:

```text
One failed record can cause entire batch to retry.
Already successful records can be retried.
```

With partial batch response:

```text
Return failed item identifiers.
Only failed messages are retried.
```

AWS Lambda documentation recommends partial batch response logic to prevent successfully processed SQS messages from being retried when only some messages fail. [10]

Conceptual handler:

```java
public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
    List<SQSBatchResponse.BatchItemFailure> failures = new ArrayList<>();

    for (SQSEvent.SQSMessage message : event.getRecords()) {
        try {
            processOne(message);
        } catch (NonRetryableMessageException e) {
            // Record and swallow so message is not retried forever.
            recordInvalidMessage(message, e);
        } catch (Exception e) {
            failures.add(new SQSBatchResponse.BatchItemFailure(message.getMessageId()));
        }
    }

    return new SQSBatchResponse(failures);
}
```

Design nuance:

```text
Non-retryable malformed message:
  do not keep retrying it forever.

Retryable downstream outage:
  fail that item so Lambda/SQS retries later.

Partially processed side effect:
  idempotency required before retry.
```

---

## 19. Poison Messages and DLQ Are Not Enough

A poison message is a message that repeatedly fails.

But there are different kinds:

```text
Malformed payload
Unknown schema version
Missing referenced resource
Domain impossible transition
Temporary dependency outage
Permission/config issue
Code bug
Large payload/pathological input
```

Only some belong in a DLQ.

DLQ anti-pattern:

```text
“Just send failed messages to DLQ.”
```

Better:

```text
Classify failure before DLQ:

Malformed / schema invalid
  -> invalid-message quarantine

Domain conflict
  -> business exception queue / manual review

Dependency transient
  -> retry with backoff, then DLQ if exhausted

Permission/config outage
  -> stop consumer or alert; DLQ flooding is symptom, not solution

Code bug
  -> DLQ preserves payload for replay after fix
```

DLQ needs runbook:

```text
- Who owns it?
- What dashboard shows depth and age?
- What fields are needed to diagnose?
- How to replay safely?
- How to avoid replay storm?
- How to mark unrecoverable messages final?
- How to preserve audit evidence?
```

---

## 20. State Machine View of Failure

For serious systems, model long-running processing as states.

Example document processing:

```text
RECEIVED
  -> STORED_IN_S3
  -> SCAN_REQUESTED
  -> SCAN_PASSED
  -> METADATA_EXTRACTED
  -> READY_FOR_REVIEW
  -> VERIFIED
```

Failure states:

```text
STORE_FAILED_RETRYABLE
STORE_FAILED_FINAL
SCAN_FAILED_RETRYABLE
SCAN_FAILED_FINAL
QUARANTINED
MANUAL_REVIEW_REQUIRED
```

Why state machine helps:

```text
- retry has source and target state,
- compensation is explicit,
- duplicate event can be ignored if state already advanced,
- out-of-order event can be rejected,
- audit trail is reconstructable,
- operations know what to repair.
```

Example invariant:

```text
SCAN_PASSED can only be entered from SCAN_REQUESTED.
VERIFIED can only be entered after READY_FOR_REVIEW.
```

This protects against duplicate/out-of-order AWS events.

---

## 21. Outbox Pattern for AWS Publishing

If your app changes database state and publishes SNS/EventBridge/SQS message, never rely on this sequence as atomic:

```text
1. update DB
2. publish event
```

Failure cases:

```text
DB commit succeeds, publish fails -> state changed but no event
Publish succeeds, DB commit fails -> event says something happened but DB disagrees
Process crashes between steps -> uncertain
```

Outbox pattern:

```text
DB transaction:
  - update domain aggregate
  - insert outbox event with eventId

Publisher loop:
  - read unpublished outbox rows
  - publish to SNS/SQS/EventBridge
  - mark published

Subscriber:
  - dedupe by eventId
```

This converts ambiguous publish into repairable state:

```text
Unpublished outbox row older than threshold -> alert/retry
Published but mark failed -> may republish; subscriber idempotency handles duplicates
```

Java design sketch:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    Case c = caseRepository.getForUpdate(command.caseId());
    c.approve(command.officerId());
    caseRepository.save(c);

    outboxRepository.insert(new OutboxEvent(
            command.commandId(),
            "CaseApproved",
            c.id(),
            serialize(new CaseApprovedEvent(c.id(), c.version()))));
}
```

Publisher:

```java
public void publishPending() {
    List<OutboxEvent> batch = outboxRepository.lockNextBatch(100);

    for (OutboxEvent event : batch) {
        try {
            sns.publish(toPublishRequest(event));
            outboxRepository.markPublished(event.id());
        } catch (AwsDependencyException e) {
            outboxRepository.recordFailure(event.id(), e);
            if (e.failureKind() == FailureKind.AUTHORIZATION) {
                throw e; // stop; config/security issue
            }
        }
    }
}
```

---

## 22. Inbox Pattern for AWS Consumers

Outbox protects producers. Inbox protects consumers.

```text
On event received:
  - insert eventId into inbox table with unique constraint
  - if duplicate: ack and exit
  - process event
  - mark consumed
```

Inbox table:

```text
event_id
source
event_type
payload_hash
received_at
processed_at
status
failure_code
attempt_count
```

This is stronger than in-memory dedupe because SQS/SNS/EventBridge duplicates can arrive after process restart.

---

## 23. Observability Requirements for Failures

Every AWS failure log should answer:

```text
What operation failed?
Against which AWS service/resource?
Which application command/event/request caused it?
Was it retryable?
Was completion ambiguous?
Was it a duplicate?
What will happen next?
What should ops do?
```

Minimum structured fields:

```text
timestamp
level
correlation_id
trace_id
service_name
application_component
aws_service
aws_operation
aws_region
aws_account_id, when safe
aws_resource_arn or redacted resource reference
aws_request_id
http_status_code
aws_error_code
failure_kind
operation_kind
idempotency_key
attempt_number
max_attempts
remaining_budget_ms
retry_decision
message_id/event_id
queue_url/topic_arn/bucket/key, redacted where needed
```

Example log:

```json
{
  "level": "WARN",
  "message": "AWS dependency throttled; scheduling retry",
  "correlationId": "req-123",
  "awsService": "sqs",
  "awsOperation": "SendMessageBatch",
  "awsRegion": "ap-southeast-1",
  "awsRequestId": "...",
  "httpStatusCode": 400,
  "awsErrorCode": "ThrottlingException",
  "failureKind": "THROTTLING",
  "operationKind": "IDEMPOTENT_WRITE",
  "attempt": 2,
  "maxAttempts": 3,
  "retryDelayMs": 750,
  "idempotencyKey": "case-123-event-456"
}
```

Do not log secrets, full payloads, access tokens, signed URLs, or sensitive documents.

---

## 24. Metrics for Failure Modelling

Metrics should separate causes.

Bad metric:

```text
aws_errors_total
```

Better:

```text
aws_dependency_calls_total{service, operation, outcome}
aws_dependency_latency_ms{service, operation}
aws_dependency_retries_total{service, operation, failure_kind}
aws_dependency_throttles_total{service, operation}
aws_dependency_timeouts_total{service, operation}
aws_dependency_authz_failures_total{service, operation}
aws_dependency_ambiguous_completions_total{service, operation}
aws_dependency_partial_failures_total{service, operation}
sqs_message_processing_failures_total{queue, failure_kind}
sqs_dlq_depth{queue}
sqs_oldest_message_age_seconds{queue}
outbox_unpublished_count{event_type}
outbox_oldest_unpublished_age_seconds{event_type}
inbox_duplicates_total{event_type}
```

Alert examples:

```text
- AccessDenied > 0 in PROD for critical service -> urgent
- throttling sustained for 10 min -> capacity/concurrency issue
- DLQ depth increasing -> workflow failure
- oldest outbox event > SLA -> event publication broken
- ambiguous completion spike -> network/timeout issue
- timeout p99 near request budget -> impending outage
```

---

## 25. Audit and Regulatory Defensibility

For regulated systems, failure handling must be explainable.

Bad audit story:

```text
“We retried a few times and then it worked.”
```

Good audit story:

```text
Command C was accepted at T1.
Domain state transitioned from REVIEW_PENDING to APPROVED at T2 by officer O.
Outbox event E was created in the same transaction.
SNS publish initially failed due to throttling at T3 with AWS request ID R.
Publisher retried according to policy P.
Event E was published at T4.
Subscriber S processed event E once logically; duplicate delivery at T5 was ignored due to inbox record I.
No unauthorized state transition occurred.
```

Evidence requirements:

```text
- command id
- actor id/system id
- domain entity id/version
- AWS request id
- event id
- idempotency key
- state before/after
- failure classification
- retry/replay action
- operator action, if any
```

---

## 26. Anti-Patterns

### 26.1 Catch `Exception` and Retry

```java
catch (Exception e) {
    Thread.sleep(1000);
    return callAgain();
}
```

Problems:

```text
- retries validation errors,
- retries AccessDenied,
- duplicates writes,
- blocks threads,
- hides failure cause,
- ignores deadline.
```

### 26.2 Treat All 4xx as User Error

AWS 403 can be your service role misconfiguration. AWS 404 can be environment drift. AWS 400 can be throttling in some services.

### 26.3 Treat SDK Retry as Complete Resilience

SDK retry cannot protect domain invariants.

### 26.4 DLQ Without Replay Design

A DLQ with no owner, no dashboard, no replay tooling, and no classification is just delayed data loss.

### 26.5 Non-Idempotent Lambda Handler

If Lambda processes SQS/SNS/EventBridge and performs side effects without dedupe, duplicates will eventually hurt you.

### 26.6 Logging Only Message String

```java
log.error("AWS failed: {}", e.getMessage());
```

You need request id, error code, status, operation, correlation id.

### 26.7 Retrying Inside Database Transaction

Holding DB locks while waiting/retrying AWS calls can create cascading failure.

Better:

```text
commit domain state + outbox
publish outside DB transaction
```

### 26.8 Calling AWS in Entity Listener / Constructor / Static Init

This makes failure timing unpredictable and startup fragile.

### 26.9 Infinite Consumer Retry

Poison message consumes capacity forever unless classified and quarantined.

### 26.10 Ignoring Local Saturation

Connection pool exhaustion is not fixed by more retry. It may require reducing concurrency, increasing pool size carefully, or fixing blocking behavior.

---

## 27. Production-Grade Failure Policy Examples

### 27.1 Read Secret at Startup

```text
Operation: GetSecretValue
Failure: ResourceNotFound
Decision: fail startup
Reason: mandatory deployment config missing
```

```text
Operation: GetSecretValue
Failure: transient 503
Decision: retry during startup within bounded boot deadline
If still fails: fail startup
Reason: service cannot safely run without initial secret
```

### 27.2 Refresh Secret at Runtime

```text
Operation: GetSecretValue
Failure: transient/throttling
Decision: keep existing cached secret, schedule retry, warn
Reason: stale known-good value may be safer than outage
```

```text
Operation: GetSecretValue
Failure: AccessDenied
Decision: alert and keep cached value temporarily if allowed
Reason: permission regression; may become outage on next restart
```

### 27.3 Publish Domain Event

```text
Operation: SNS Publish
Failure: timeout
Decision: do not blindly retry inside request thread
Design: outbox publisher retries; subscriber dedupes eventId
```

### 27.4 Process SQS Message

```text
Operation: process message + write DB + delete SQS
Failure: DB commit success, DeleteMessage timeout
Decision: treat business processing as done; duplicate later will be ignored by inbox/idempotency
```

### 27.5 Upload Document to S3

```text
Operation: PutObject deterministic key
Failure: timeout
Decision: HeadObject + checksum reconciliation
```

### 27.6 S3 `NoSuchKey`

```text
Use case A: user downloads optional attachment
Decision: return 404 domain not found

Use case B: metadata DB says document exists but S3 key missing
Decision: data integrity incident, not simple 404
```

Same AWS error, different domain meaning.

---

## 28. Java Version Considerations: 8 to 25

The failure model is mostly independent of Java version, but implementation details differ.

### Java 8

Constraints:

```text
- no records,
- older TLS/runtime defaults depending on distribution,
- less ergonomic Optional/streams than modern Java,
- no virtual threads,
- often older enterprise frameworks.
```

Recommendations:

```text
- use explicit immutable classes,
- centralize AWS client lifecycle,
- avoid blocking retry loops,
- use mature executor design,
- be careful with dependency versions.
```

### Java 11/17

Better baseline:

```text
- stronger runtime performance,
- modern TLS defaults,
- records from Java 16+ if using 17,
- better GC options,
- better container awareness.
```

### Java 21/25

Potential advantages:

```text
- virtual threads for blocking orchestration, if runtime/framework supports,
- better GC/runtime behavior,
- improved language ergonomics,
- more expressive domain failure models.
```

But do not confuse virtual threads with AWS backpressure. Virtual threads can make blocking cheaper, but they do not increase AWS quota, SQS throughput, KMS limits, or downstream capacity.

Important rule:

```text
More concurrency is not resilience. Controlled concurrency is resilience.
```

---

## 29. Failure Modelling Checklist

For every AWS integration, answer these questions.

### Operation Semantics

```text
- Is it read-only?
- Is it a create/update/delete?
- Is it naturally idempotent?
- Does AWS API support idempotency token?
- Can the result be reconciled?
- Is the side effect externally visible?
```

### Failure Classification

```text
- What are expected service-specific error codes?
- Which errors mean config bug?
- Which errors mean auth/IAM bug?
- Which errors mean domain absence?
- Which errors are retryable?
- Which errors are ambiguous?
- Which batch APIs can partially fail?
```

### Retry Policy

```text
- Who owns retry: SDK, app, queue, Lambda, operator?
- What is max attempt count?
- What is backoff and jitter?
- What is deadline/budget?
- What happens after retries exhausted?
- How is retry storm prevented?
```

### Idempotency

```text
- What is the idempotency key?
- Where is it stored?
- Is payload hash checked?
- What is TTL?
- What happens on duplicate?
- What happens on in-progress stale record?
```

### Observability

```text
- Is AWS request ID logged?
- Are error code/status/service/operation logged?
- Are attempts counted?
- Are throttles separate from 5xx?
- Is DLQ monitored?
- Is outbox age monitored?
```

### Recovery

```text
- Can failed work be replayed?
- Can duplicate replay corrupt state?
- Is manual repair documented?
- Is compensation audited?
- Can operators see root cause?
```

---

## 30. Practical Design Exercise

Scenario:

```text
A Java service receives a request to approve a licensing case.
When approved, it must:
1. update case status in DB,
2. generate approval PDF,
3. upload PDF to S3,
4. publish CaseApproved event to SNS,
5. send notification via downstream subscriber,
6. write audit record.
```

Naive sequence:

```text
DB update -> PDF -> S3 -> SNS -> audit
```

Failure problems:

```text
- DB update succeeds but S3 upload fails.
- S3 upload succeeds but SNS publish times out.
- SNS publish succeeds but audit write fails.
- User retries approval request.
- SQS subscriber receives duplicate event.
- Notification sent twice.
```

Better model:

```text
Transaction 1:
  - validate transition REVIEW_PENDING -> APPROVED
  - store case status APPROVED with version increment
  - create document generation job or outbox command
  - write audit intent/domain audit row

Async document worker:
  - generate PDF deterministically for case version
  - upload to S3 deterministic key
  - reconcile on timeout using checksum
  - mark document stored

Outbox publisher:
  - publish CaseApproved event with eventId and caseVersion
  - mark published

Subscriber:
  - inbox dedupe eventId
  - send notification using notification idempotency key
```

Invariants:

```text
- case approval transition is atomic in DB,
- each approved case version has at most one logical approval document,
- each domain event has stable eventId,
- duplicate deliveries do not duplicate notification,
- all failed async work is visible and replayable.
```

Failure policy:

```text
S3 timeout:
  HeadObject + checksum before retry.

SNS timeout:
  outbox retry; subscribers dedupe.

SQS duplicate:
  inbox idempotency.

AccessDenied:
  stop worker, alert; do not flood DLQ.

Validation/domain conflict:
  final failure/manual review, not retry.
```

This is the difference between “using AWS SDK” and “engineering a reliable cloud-integrated system”.

---

## 31. Minimal Reference Implementation Sketch

This is not final framework code. It shows the shape of thinking.

```java
public enum OperationKind {
    READ,
    IDEMPOTENT_WRITE,
    NON_IDEMPOTENT_WRITE,
    BATCH_WRITE,
    DELETE,
    EVENT_PUBLISH,
    MESSAGE_CONSUME
}
```

```java
public final class AwsOperationContext {
    private final String service;
    private final String operation;
    private final OperationKind operationKind;
    private final String resource;
    private final String correlationId;
    private final String idempotencyKey;
    private final int attempt;
    private final long remainingBudgetMillis;

    // constructor/getters omitted
}
```

```java
public interface AwsFailurePolicy {
    FailureAction decide(AwsOperationContext context, AwsFailure failure);
}
```

```java
public final class DefaultAwsFailurePolicy implements AwsFailurePolicy {
    @Override
    public FailureAction decide(AwsOperationContext ctx, AwsFailure failure) {
        switch (failure.kind()) {
            case VALIDATION:
            case AUTHENTICATION:
            case AUTHORIZATION:
                return FailureAction.FAIL_FAST;

            case NOT_FOUND:
                return ctx.operationKind() == OperationKind.READ
                        ? FailureAction.RETURN_ABSENCE
                        : FailureAction.FAIL_FAST;

            case THROTTLING:
            case TRANSIENT_SERVICE:
                return ctx.remainingBudgetMillis() > 0
                        ? FailureAction.RETRY
                        : FailureAction.SEND_TO_DLQ;

            case TIMEOUT:
            case TRANSPORT:
                if (ctx.operationKind() == OperationKind.NON_IDEMPOTENT_WRITE
                        || ctx.operationKind() == OperationKind.EVENT_PUBLISH) {
                    return FailureAction.RETRY_AFTER_RECONCILIATION;
                }
                return ctx.remainingBudgetMillis() > 0
                        ? FailureAction.RETRY
                        : FailureAction.SEND_TO_DLQ;

            case PARTIAL_SUCCESS:
                return FailureAction.MANUAL_REPAIR;

            default:
                return FailureAction.MANUAL_REPAIR;
        }
    }
}
```

This policy should be adjusted per operation. A universal policy is dangerous. But having a shared vocabulary prevents inconsistent handling across teams.

---

## 32. What Top 1% Engineers Internalize

They do not ask only:

```text
Which exception class should I catch?
```

They ask:

```text
What did the remote system possibly do?
What state could now exist?
Can I safely repeat this operation?
If duplicate happens, who dedupes it?
If partial success happens, where is item-level state stored?
If retry is exhausted, who owns recovery?
If AWS returns AccessDenied, is that user authz or service misconfiguration?
If SQS redelivers, do I corrupt state?
If Lambda retries batch, do successful records repeat?
If SNS publish times out, can I reconcile?
What evidence will I have during incident review?
```

That is the difference between API usage and system design.

---

## 33. Summary

Key takeaways:

1. AWS errors must be classified by **system meaning**, not just Java class.
2. Remote calls have three outcomes: confirmed success, confirmed failure, and ambiguous completion.
3. `AwsServiceException` means AWS returned an error response; `SdkClientException` means client-side completion failed or no usable service response was obtained. [1][8]
4. Retry is safe only when the failure is transient, the operation is safe to repeat, budget remains, and retry will not amplify overload.
5. Idempotency is mandatory for reliable event/message processing.
6. Batch APIs require item-level outcome handling.
7. SQS/Lambda consumers must expect duplicate processing and partial batch failure. [4][5][10]
8. DLQ is not a strategy unless replay, ownership, classification, and monitoring exist.
9. Production systems should translate AWS exceptions into domain-relevant dependency failures.
10. Regulatory-grade systems need evidence: request ID, correlation ID, state transition, idempotency key, failure kind, and recovery action.

---

## 34. References

[1] AWS SDK for Java 2.x Developer Guide — Handling errors:  
https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/handling-exceptions.html

[2] AWS SDK for Java 2.x Developer Guide — Configure retry behavior:  
https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html

[3] AWS SDKs and Tools Reference Guide — Retry behavior:  
https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html

[4] Amazon SQS Developer Guide — At-least-once delivery:  
https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html

[5] AWS Lambda Developer Guide — Handling errors for an SQS event source:  
https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html

[6] AWS SDK for Java API Reference — RetryMode:  
https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/core/retry/RetryMode.html

[7] Amazon ECS API Reference — Ensuring idempotency with client tokens:  
https://docs.aws.amazon.com/AmazonECS/latest/APIReference/ECS_Idempotency.html

[8] AWS SDK for Java API Reference — SdkClientException:  
https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/core/exception/SdkClientException.html

[9] AWS Lambda Developer Guide — Asynchronous invocation error handling:  
https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html

[10] AWS Lambda Developer Guide — Using Lambda with Amazon SQS:  
https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html

---

## 35. Next Part

Next: **Part 6 — Observability for Java AWS Integration**.

Part 6 will build on this failure taxonomy and show how to instrument Java AWS calls so production incidents can be diagnosed quickly: structured logs, metrics, traces, AWS request IDs, retry visibility, CloudWatch, X-Ray/OpenTelemetry positioning, dashboard design, and audit evidence.
