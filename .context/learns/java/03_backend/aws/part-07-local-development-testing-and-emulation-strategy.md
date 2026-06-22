# Part 7 — Local Development, Testing, and Emulation Strategy

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target: Java 8–25, AWS SDK for Java 2.x, Lambda, S3, SQS, SNS, Secrets Manager, SSM Parameter Store, IAM, KMS, CloudWatch  
Level: Advanced / production engineering  
Status: Part 7 of 35

---

## 0. Why This Part Exists

A Java engineer who integrates with AWS services has a testing problem that is deeper than normal unit testing.

In a normal Java application, a dependency might be a local object, a database, a REST API, a message broker, or a file system. With AWS, the dependency is often a managed cloud service with its own identity boundary, regional endpoint, quota, retry model, consistency behavior, IAM permission model, encryption policy, billing model, and operational behavior.

That means this question is not enough:

> “Can my Java code call S3/SQS/SNS/Secrets Manager successfully?”

The better question is:

> “Can this system continue to behave correctly when the AWS dependency is slow, unavailable, throttling, eventually consistent, permission-denied, partially successful, duplicated, replayed, misconfigured, or different between local, sandbox, UAT, and production?”

This part builds a mental model and practical strategy for local development, automated tests, emulation, sandbox AWS testing, contract tests, replay tests, and failure injection.

The goal is not to test AWS itself. AWS already tests AWS. Your job is to test your assumptions about how your application uses AWS.

---

## 1. The Core Mental Model

### 1.1 You are not testing “AWS”. You are testing boundaries.

When a Java service integrates with AWS, there are several boundaries:

```text
Java business logic
    ↓
Application port/interface
    ↓
AWS adapter/gateway
    ↓
AWS SDK client
    ↓
HTTP transport
    ↓
AWS regional endpoint
    ↓
AWS service control/data plane
```

Each boundary should be tested differently.

You do not need LocalStack to test pure domain rules.  
You do not need a real AWS account to test retry classification.  
You often do need real AWS to validate IAM, KMS, service limits, cross-account behavior, event source mappings, and production-like service integration.

A top-tier engineer does not ask “mock or real?” as a binary choice. They ask:

> “Which assumption am I trying to validate, and what is the cheapest reliable environment that can validate it?”

---

### 1.2 The testing target is not only correctness

For AWS-integrated Java applications, tests should validate at least seven categories:

| Category | Question |
|---|---|
| Functional correctness | Does the code do the expected operation? |
| Contract correctness | Does the request/response schema and event payload match what producers/consumers expect? |
| Identity correctness | Does the runtime identity have exactly the permissions needed? |
| Failure correctness | Does the system behave safely when AWS calls fail? |
| Operational correctness | Are logs, metrics, traces, and request IDs available when debugging? |
| Cost/quota correctness | Does the code avoid unbounded API calls, polling, retries, and log volume? |
| Environment correctness | Does the same artifact behave predictably in local, CI, sandbox, UAT, and production? |

Most weak AWS tests only cover the first item. Strong systems cover all seven.

---

## 2. The AWS Testing Pyramid for Java

A useful testing pyramid for this series looks like this:

```text
                    ┌─────────────────────────────┐
                    │ Production canary / smoke    │
                    │ Real AWS, minimal cases      │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Sandbox / UAT integration    │
                    │ Real IAM, KMS, S3, SQS, etc. │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Emulator-backed tests        │
                    │ LocalStack/Testcontainers    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Adapter tests with fake SDK  │
                    │ Stubbed clients/responses    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Pure unit/domain tests       │
                    │ No AWS dependency            │
                    └─────────────────────────────┘
```

The lower layers should be fast, deterministic, and numerous.  
The upper layers should be fewer, slower, more expensive, but more realistic.

The anti-pattern is putting everything at one layer:

- All mocks: fast but low confidence.
- All LocalStack: good for local feedback but may hide AWS-specific behavior.
- All real AWS: expensive, slower, flaky if poorly isolated, harder to run on every commit.
- All manual testing: not engineering, just hope with screenshots.

---

## 3. Layer 1 — Pure Unit Tests

### 3.1 What belongs here

Pure unit tests should cover logic that does not need AWS at all:

- Object key generation.
- Message payload construction.
- Event versioning rules.
- S3 path partitioning.
- Idempotency key calculation.
- Retry decision mapping.
- DLQ classification rules.
- IAM policy document generation if your platform generates policies.
- Secret name validation.
- Parameter path validation.
- Domain state transition rules.

Example:

```java
final class S3ObjectKeyPolicy {
    String keyForCaseDocument(String agencyCode, String caseId, String documentId, String filename) {
        requireSafeSegment(agencyCode, "agencyCode");
        requireSafeSegment(caseId, "caseId");
        requireSafeSegment(documentId, "documentId");
        requireSafeFilename(filename);

        return "agency=" + agencyCode
                + "/case=" + caseId
                + "/document=" + documentId
                + "/original/" + filename;
    }

    private static void requireSafeSegment(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
        if (!value.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException(name + " contains unsafe characters");
        }
    }

    private static void requireSafeFilename(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("filename is required");
        }
        if (value.contains("/") || value.contains("\\\\") || value.contains("..")) {
            throw new IllegalArgumentException("filename is unsafe");
        }
    }
}
```

Test:

```java
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class S3ObjectKeyPolicyTest {

    @Test
    void generatesStableObjectKey() {
        S3ObjectKeyPolicy policy = new S3ObjectKeyPolicy();

        String key = policy.keyForCaseDocument(
                "CEA",
                "CASE-123",
                "DOC-456",
                "evidence.pdf"
        );

        assertEquals(
                "agency=CEA/case=CASE-123/document=DOC-456/original/evidence.pdf",
                key
        );
    }

    @Test
    void rejectsPathTraversalLikeFilename() {
        S3ObjectKeyPolicy policy = new S3ObjectKeyPolicy();

        assertThrows(IllegalArgumentException.class, () ->
                policy.keyForCaseDocument("CEA", "CASE-123", "DOC-456", "../secret.txt")
        );
    }
}
```

This test should not involve S3. The point is not whether S3 accepts a key. The point is whether your system has a stable and safe key convention.

---

### 3.2 The key design move: isolate AWS behind ports

Bad design:

```java
final class CaseDocumentService {
    private final S3Client s3;

    CaseDocumentService(S3Client s3) {
        this.s3 = s3;
    }

    void upload(String caseId, byte[] content) {
        s3.putObject(...);
    }
}
```

This is not always terrible, but it causes your business service to know too much about S3. A better design is:

```java
interface CaseDocumentStore {
    StoredDocument putOriginal(CaseDocument document);
    StoredDocument getOriginal(String caseId, String documentId);
}
```

Then your S3 adapter implements it:

```java
final class S3CaseDocumentStore implements CaseDocumentStore {
    private final S3Client s3;
    private final String bucket;
    private final S3ObjectKeyPolicy keyPolicy;

    S3CaseDocumentStore(S3Client s3, String bucket, S3ObjectKeyPolicy keyPolicy) {
        this.s3 = s3;
        this.bucket = bucket;
        this.keyPolicy = keyPolicy;
    }

    @Override
    public StoredDocument putOriginal(CaseDocument document) {
        String key = keyPolicy.keyForCaseDocument(
                document.agencyCode(),
                document.caseId(),
                document.documentId(),
                document.filename()
        );

        s3.putObject(builder -> builder
                        .bucket(bucket)
                        .key(key)
                        .contentType(document.contentType())
                        .metadata(Map.of(
                                "case-id", document.caseId(),
                                "document-id", document.documentId()
                        )),
                RequestBody.fromBytes(document.content())
        );

        return new StoredDocument(bucket, key, document.content().length);
    }
}
```

The business layer can then be tested using a fake `CaseDocumentStore`, while the S3 adapter is tested separately.

This is the single most important testing design principle in AWS-integrated Java applications:

> Put AWS behind explicit application-owned interfaces. Do not let AWS types spread into your domain model.

---

## 4. Layer 2 — Adapter Tests with Stubbed SDK Clients

### 4.1 What this layer validates

Adapter tests validate that your AWS adapter builds correct SDK requests, handles SDK responses, and classifies SDK exceptions correctly.

They should answer questions like:

- Does this adapter put objects into the configured bucket?
- Does it set expected metadata?
- Does it use the correct queue URL?
- Does it publish the expected message attributes?
- Does it convert AWS exceptions to application-level exceptions?
- Does it avoid logging secrets?
- Does it treat throttling differently from validation errors?

These tests usually use Mockito, hand-written fakes, or a custom fake interface.

---

### 4.2 Avoid over-mocking SDK internals

AWS SDK v2 clients are interfaces such as `S3Client`, `SqsClient`, `SnsClient`, `SecretsManagerClient`, and `SsmClient`. You can mock them. But avoid mocking deep SDK internals such as HTTP clients, marshallers, interceptors, or internal execution context unless you are testing your own SDK wrapper.

Good mock target:

```java
S3Client s3 = mock(S3Client.class);
```

Poor mock target:

```java
SdkHttpClient httpClient = mock(SdkHttpClient.class);
```

For most application tests, your abstraction level should be service clients and application adapters, not SDK internals.

---

### 4.3 Example: testing an SQS publisher adapter

Application port:

```java
interface CaseEventPublisher {
    void publishCaseSubmitted(CaseSubmittedEvent event);
}
```

Adapter:

```java
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.MessageAttributeValue;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.time.Clock;
import java.util.Map;

final class SqsCaseEventPublisher implements CaseEventPublisher {
    private final SqsClient sqs;
    private final String queueUrl;
    private final JsonCodec jsonCodec;
    private final Clock clock;

    SqsCaseEventPublisher(SqsClient sqs, String queueUrl, JsonCodec jsonCodec, Clock clock) {
        this.sqs = sqs;
        this.queueUrl = queueUrl;
        this.jsonCodec = jsonCodec;
        this.clock = clock;
    }

    @Override
    public void publishCaseSubmitted(CaseSubmittedEvent event) {
        String payload = jsonCodec.toJson(event);

        SendMessageRequest request = SendMessageRequest.builder()
                .queueUrl(queueUrl)
                .messageBody(payload)
                .messageAttributes(Map.of(
                        "eventType", MessageAttributeValue.builder()
                                .dataType("String")
                                .stringValue("CaseSubmitted")
                                .build(),
                        "eventVersion", MessageAttributeValue.builder()
                                .dataType("String")
                                .stringValue("1")
                                .build(),
                        "occurredAt", MessageAttributeValue.builder()
                                .dataType("String")
                                .stringValue(clock.instant().toString())
                                .build()
                ))
                .build();

        sqs.sendMessage(request);
    }
}
```

Test:

```java
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SqsCaseEventPublisherTest {

    @Test
    void sendsCaseSubmittedEventWithStableAttributes() {
        SqsClient sqs = mock(SqsClient.class);
        JsonCodec jsonCodec = new JacksonJsonCodec();
        Clock clock = Clock.fixed(Instant.parse("2026-06-19T10:00:00Z"), ZoneOffset.UTC);

        when(sqs.sendMessage(any(SendMessageRequest.class)))
                .thenReturn(SendMessageResponse.builder().messageId("msg-1").build());

        SqsCaseEventPublisher publisher = new SqsCaseEventPublisher(
                sqs,
                "https://sqs.ap-southeast-1.amazonaws.com/123456789012/case-events",
                jsonCodec,
                clock
        );

        publisher.publishCaseSubmitted(new CaseSubmittedEvent("CASE-123", "CEA"));

        ArgumentCaptor<SendMessageRequest> captor = ArgumentCaptor.forClass(SendMessageRequest.class);
        verify(sqs).sendMessage(captor.capture());

        SendMessageRequest request = captor.getValue();
        assertEquals("https://sqs.ap-southeast-1.amazonaws.com/123456789012/case-events", request.queueUrl());
        assertEquals("CaseSubmitted", request.messageAttributes().get("eventType").stringValue());
        assertEquals("1", request.messageAttributes().get("eventVersion").stringValue());
        assertEquals("2026-06-19T10:00:00Z", request.messageAttributes().get("occurredAt").stringValue());
    }
}
```

This does not prove SQS works. It proves your adapter builds the intended request.

---

## 5. Layer 3 — Emulator-Backed Tests

### 5.1 What emulator tests are good for

Emulator-backed tests, commonly using LocalStack with Testcontainers, are good for validating local integration behavior without touching real AWS.

They are useful for:

- Running repeatable tests in CI.
- Testing basic S3/SQS/SNS/Secrets/SSM flows.
- Checking serialization/deserialization against service-like APIs.
- Exercising AWS SDK endpoint override configuration.
- Running local development without cloud credentials.
- Testing local startup scripts and resource provisioning.
- Preventing obvious integration mistakes before sandbox AWS tests.

LocalStack’s Testcontainers integration is specifically designed for running tests against a local AWS-like environment, and the Testcontainers LocalStack module provides Java support for creating SDK clients that point to the local container endpoint.

---

### 5.2 What emulator tests are not enough for

Emulators are not a complete substitute for AWS.

They may not fully reproduce:

- IAM evaluation behavior.
- KMS key policy behavior.
- Cross-account policies.
- S3 event notification edge cases.
- Lambda event source mapping details.
- CloudWatch metric/log behavior.
- Regional service differences.
- Throttling behavior.
- Service quotas.
- Eventually consistent operational edge cases.
- Managed service internal retry behavior.

So the rule is:

> Use emulators for fast feedback. Use real AWS for confidence in cloud-specific behavior.

---

### 5.3 SDK endpoint override

For local AWS-compatible endpoints, AWS SDK for Java 2.x service clients can use `endpointOverride(URI)`.

Example:

```java
SqsClient sqs = SqsClient.builder()
        .region(Region.AP_SOUTHEAST_1)
        .credentialsProvider(StaticCredentialsProvider.create(
                AwsBasicCredentials.create("test", "test")
        ))
        .endpointOverride(URI.create("http://localhost:4566"))
        .build();
```

Important points:

- You still need a region, even with local endpoints.
- You usually use dummy credentials for LocalStack.
- Endpoint override must never leak into production configuration.
- Prefer environment-specific configuration objects over ad-hoc conditionals.

Bad:

```java
if (System.getenv("LOCALSTACK") != null) {
    builder.endpointOverride(URI.create("http://localhost:4566"));
}
```

Better:

```java
record AwsClientProperties(
        Region region,
        Optional<URI> endpointOverride,
        AwsCredentialsProvider credentialsProvider
) {}
```

Then the factory becomes explicit:

```java
final class AwsClientFactory {
    private final AwsClientProperties properties;

    AwsClientFactory(AwsClientProperties properties) {
        this.properties = properties;
    }

    SqsClient sqsClient() {
        SqsClientBuilder builder = SqsClient.builder()
                .region(properties.region())
                .credentialsProvider(properties.credentialsProvider());

        properties.endpointOverride().ifPresent(builder::endpointOverride);
        return builder.build();
    }
}
```

---

### 5.4 Example: SQS integration test with LocalStack + Testcontainers

Dependencies example for Maven:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>2.42.25</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>sqs</artifactId>
    </dependency>

    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>localstack</artifactId>
        <version>1.20.6</version>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>5.11.4</version>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Example test:

```java
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueResponse;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;

@Testcontainers
class SqsLocalStackIntegrationTest {

    @Container
    static LocalStackContainer localstack = new LocalStackContainer(
            DockerImageName.parse("localstack/localstack:4.0.3")
    ).withServices(LocalStackContainer.Service.SQS);

    @Test
    void sendsAndReceivesMessage() {
        try (SqsClient sqs = SqsClient.builder()
                .endpointOverride(localstack.getEndpointOverride(LocalStackContainer.Service.SQS))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(localstack.getAccessKey(), localstack.getSecretKey())
                ))
                .region(Region.of(localstack.getRegion()))
                .build()) {

            CreateQueueResponse created = sqs.createQueue(builder -> builder.queueName("case-events"));
            String queueUrl = created.queueUrl();

            sqs.sendMessage(builder -> builder
                    .queueUrl(queueUrl)
                    .messageBody("{\"caseId\":\"CASE-123\"}")
            );

            ReceiveMessageResponse received = sqs.receiveMessage(builder -> builder
                    .queueUrl(queueUrl)
                    .maxNumberOfMessages(1)
                    .waitTimeSeconds(1)
            );

            assertEquals(1, received.messages().size());
            assertEquals("{\"caseId\":\"CASE-123\"}", received.messages().get(0).body());
        }
    }
}
```

This validates:

- SDK endpoint override works.
- Queue creation works in the local environment.
- Send/receive flow works.
- Test infrastructure can run without real AWS credentials.

It does not validate:

- Real IAM.
- Real quota.
- Real CloudWatch metrics.
- Real SQS service behavior under load.
- Real DLQ redrive behavior in production.

---

## 6. Layer 4 — Real AWS Sandbox Integration Tests

### 6.1 Why sandbox tests are mandatory

Some assumptions can only be validated against real AWS:

- IAM permissions.
- KMS key policies.
- S3 bucket policies.
- Cross-account access.
- VPC endpoint access.
- Lambda event source mapping.
- CloudWatch logs and metrics.
- Actual service quotas.
- Real event delivery behavior.
- Service-specific validation rules.

If your system is regulated, security-sensitive, or business-critical, emulator-only testing is not enough.

---

### 6.2 Sandbox account design

A strong sandbox setup uses isolated AWS accounts or at least isolated environments.

Recommended structure:

```text
AWS Organization
├── dev-account
├── ci-integration-account
├── uat-account
└── prod-account
```

For smaller teams, this might be simplified:

```text
single AWS account
├── app-dev-* resources
├── app-test-* resources
├── app-uat-* resources
└── app-prod-* resources
```

But account separation is stronger because IAM, quota, blast radius, and billing boundaries are cleaner.

---

### 6.3 Test resource isolation

Each test run should create resources with a unique run ID:

```text
case-platform-it-20260619-101500-a8f3
```

Example naming:

```text
S3 bucket:      case-platform-it-20260619-a8f3
SQS queue:      case-platform-it-20260619-a8f3-events
SNS topic:      case-platform-it-20260619-a8f3-topic
SSM parameter:  /case-platform/it/20260619-a8f3/db/url
Secret:         case-platform/it/20260619-a8f3/db
```

Benefits:

- Parallel CI jobs do not collide.
- Cleanup is easier.
- CloudTrail investigation is easier.
- Cost attribution is easier.
- Flaky tests are less likely due to shared state.

---

### 6.4 Cleanup must be designed, not hoped for

Cloud resources persist if tests crash. Therefore every integration test suite needs cleanup strategy:

1. Normal cleanup at the end of the test.
2. Best-effort cleanup in `finally` blocks.
3. Scheduled janitor job for stale resources.
4. Tag every test resource.
5. Use TTL tags.

Example tags:

```text
Environment = integration-test
TestRunId   = 20260619-a8f3
Owner       = case-platform
ExpiresAt   = 2026-06-20T00:00:00Z
ManagedBy   = automated-test
```

Do not rely only on test code cleanup. Failed test processes, interrupted CI jobs, and permission errors will leave resources behind.

---

### 6.5 Sandbox test categories

A good AWS sandbox test suite includes:

#### Category A — Smoke integration

Minimal happy path:

- Put object to S3.
- Send SQS message.
- Publish SNS message.
- Read SSM parameter.
- Read secret.

#### Category B — IAM negative test

Validate forbidden operations are actually forbidden.

Example:

- App role can read `/app/prod/*`? It should not in dev.
- Worker role can delete from DLQ? Maybe only ops role can.
- Lambda role can decrypt KMS key? Only expected key.

#### Category C — Encryption test

Validate the intended KMS key is used.

Example:

- S3 object has SSE-KMS.
- SQS queue uses KMS key.
- Secret uses customer managed key.

#### Category D — Event delivery test

Validate that S3/SNS/EventBridge/SQS actually routes events to the expected target.

#### Category E — Observability test

Validate that logs/metrics/traces are emitted with correlation ID and AWS request ID.

#### Category F — Failure-path test

Validate expected behavior for missing object, deleted queue, access denied, throttled dependency, malformed message, duplicate message.

---

## 7. Lambda Testing Strategy for Java

### 7.1 Separate handler glue from business logic

Bad Lambda design:

```java
public final class CaseEventLambda implements RequestHandler<SQSEvent, Void> {
    @Override
    public Void handleRequest(SQSEvent event, Context context) {
        // parse message
        // call AWS
        // update DB
        // publish SNS
        // handle errors
        // log metrics
        return null;
    }
}
```

This is hard to test because everything is inside the handler.

Better:

```java
public final class CaseEventLambda implements RequestHandler<SQSEvent, SQSBatchResponse> {
    private final CaseEventBatchProcessor processor;

    public CaseEventLambda() {
        this(ApplicationBootstrap.createCaseEventBatchProcessor());
    }

    CaseEventLambda(CaseEventBatchProcessor processor) {
        this.processor = processor;
    }

    @Override
    public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
        return processor.process(event, LambdaRequestContext.from(context));
    }
}
```

Now the handler is thin. Most logic is testable without Lambda runtime.

---

### 7.2 Lambda test layers

| Layer | Purpose |
|---|---|
| Unit test processor | Test business and failure rules without Lambda runtime. |
| Handler test | Test event object mapping and handler wiring. |
| Serialization test | Test JSON event fixtures. |
| Local runtime test | Optional: use SAM/local runtime style flow. |
| Deployed Lambda test | Invoke real Lambda in sandbox. |
| Event source test | Validate SQS/SNS/S3/EventBridge actually invokes Lambda. |

---

### 7.3 Event fixture testing

Keep real-looking event payload fixtures in your repository:

```text
src/test/resources/events/sqs-case-submitted-v1.json
src/test/resources/events/sns-case-escalated-v1.json
src/test/resources/events/s3-document-uploaded-v1.json
src/test/resources/events/eventbridge-case-timer-v1.json
```

These fixtures should be treated as contracts.

Example fixture purpose:

- Validate deserialization.
- Validate required fields.
- Validate handler behavior.
- Prevent accidental breaking changes.
- Enable replay of production-like events after redaction.

---

### 7.4 Lambda partial batch response test

For SQS-triggered Lambda, partial batch failure handling is critical.

Conceptual example:

```java
@Test
void returnsOnlyFailedMessageIdsForPartialBatchFailure() {
    CaseEventBatchProcessor processor = new CaseEventBatchProcessor(
            message -> {
                if (message.messageId().equals("bad-message")) {
                    throw new RecoverableMessageException("temporary failure");
                }
            }
    );

    SQSEvent event = TestSqsEvents.withMessages("good-message", "bad-message");

    SQSBatchResponse response = processor.process(event, TestLambdaContext.context());

    assertEquals(1, response.getBatchItemFailures().size());
    assertEquals("bad-message", response.getBatchItemFailures().get(0).getItemIdentifier());
}
```

The invariant:

> A failed message must be returned as failed; a successful message must not be retried just because another message in the same batch failed.

This is a production-level invariant, not just a test detail.

---

## 8. Contract Testing for AWS Events

### 8.1 Why contract tests matter

In event-driven AWS architecture, producers and consumers are often decoupled by SQS, SNS, S3, EventBridge, or Lambda. This decoupling is powerful but dangerous.

A producer can change a field name today and break a consumer tomorrow. A consumer can assume a field is required when the producer sometimes omits it. A DLQ can fill because an event version changed silently.

Contract tests prevent these failures.

---

### 8.2 Contract dimensions

For AWS event messages, contract tests should cover:

| Dimension | Example |
|---|---|
| Envelope | SNS envelope, SQS envelope, EventBridge envelope |
| Payload schema | Required fields, optional fields, data types |
| Message attributes | `eventType`, `eventVersion`, `correlationId` |
| Version compatibility | v1 consumer can ignore new v1 optional field |
| Idempotency | Same event ID can be replayed safely |
| Ordering assumption | Consumer does not require global order unless designed for FIFO |
| Size limit | Payload does not exceed SQS/SNS/EventBridge limits |
| Redaction | Event does not leak secrets or unnecessary PII |

---

### 8.3 Schema evolution rules

A practical event schema policy:

1. Adding optional fields is backward-compatible.
2. Removing fields is breaking.
3. Renaming fields is breaking.
4. Changing meaning is breaking even if the type stays the same.
5. Changing enum values can be breaking.
6. Consumers must ignore unknown fields.
7. Producers must set explicit event version.
8. A breaking change requires a new event version.

Example event:

```json
{
  "eventId": "01J0CASE123",
  "eventType": "CaseSubmitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T10:15:30Z",
  "correlationId": "corr-abc-123",
  "source": "case-management-service",
  "data": {
    "caseId": "CASE-123",
    "agencyCode": "CEA",
    "submittedBy": "user-456"
  }
}
```

Consumer deserialization should ignore unknown fields:

```java
ObjectMapper mapper = JsonMapper.builder()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .build();
```

But producer tests should be stricter so accidental field changes are detected.

---

## 9. IAM Testing

### 9.1 IAM is a runtime contract

IAM policies are not just infrastructure configuration. They are part of the application contract.

If a service must read one secret and send to one queue, its permissions are part of the correctness of the system.

Therefore, IAM should be tested.

---

### 9.2 IAM test types

#### Static policy test

Validate the generated policy document:

- No `Action: "*"`.
- No `Resource: "*"` unless explicitly allowed.
- No broad `kms:Decrypt`.
- No unrelated service actions.
- Required conditions exist.

Example pseudo-test:

```java
@Test
void policyDoesNotAllowWildcardActions() {
    IamPolicyDocument policy = IamPolicyDocument.parse(policyJson);

    assertFalse(policy.statements().stream()
            .flatMap(statement -> statement.actions().stream())
            .anyMatch(action -> action.equals("*")));
}
```

#### Sandbox allow test

Validate the app role can do what it should:

- `s3:PutObject` to expected bucket/prefix.
- `sqs:SendMessage` to expected queue.
- `secretsmanager:GetSecretValue` to expected secret.

#### Sandbox deny test

Validate the app role cannot do what it should not:

- Cannot read another environment’s secret.
- Cannot delete a bucket.
- Cannot purge queue.
- Cannot decrypt unrelated KMS key.

Deny tests are underrated. They catch over-permissive production roles.

---

### 9.3 Avoid brittle IAM tests

Do not assert that the exact policy JSON string is identical unless your infrastructure generator requires it. IAM documents can be reordered while semantically equivalent.

Better assertions:

- Required actions are present.
- Forbidden actions are absent.
- Resources are scoped.
- Conditions are present.
- Wildcards are justified and documented.

---

## 10. Failure Injection Testing

### 10.1 Why failure injection matters

Many AWS integration bugs only appear under failure:

- S3 upload succeeds but metadata update fails.
- SQS message is processed but delete fails.
- SNS publish times out but actually succeeded.
- Secret rotation happens while the connection pool still uses old credentials.
- Lambda times out mid-operation.
- Retry storm amplifies downstream throttling.

You cannot prove resilience using only happy-path tests.

---

### 10.2 Failure categories to inject

| Failure | How to test |
|---|---|
| Access denied | Use role without permission or stub `AccessDeniedException`. |
| Not found | Request missing S3 key, missing secret, missing parameter. |
| Throttling | Stub `ThrottlingException` or configure low quotas in sandbox where possible. |
| Timeout | Use fake adapter that sleeps beyond timeout. |
| Partial batch failure | Make one message fail in SQS batch. |
| Duplicate message | Deliver same message twice. |
| Out-of-order event | Deliver state transition events in wrong order. |
| Poison message | Malformed payload repeatedly fails. |
| Downstream unavailable | Stub dependency failure after AWS message is received. |
| Cleanup failure | Make delete/archive fail after processing. |

---

### 10.3 Testing retry classification

Retry tests should not sleep for real time if avoidable. Use small retry policies, fake clocks, or direct classifier tests.

Example classifier:

```java
final class AwsFailureClassifier {
    FailureDecision classify(Throwable error) {
        if (error instanceof AwsServiceException serviceException) {
            int status = serviceException.statusCode();
            String code = serviceException.awsErrorDetails() == null
                    ? ""
                    : serviceException.awsErrorDetails().errorCode();

            if (status == 429 || code.contains("Throttl")) {
                return FailureDecision.RETRY_WITH_BACKOFF;
            }
            if (status >= 500) {
                return FailureDecision.RETRY_WITH_BACKOFF;
            }
            if (status == 403) {
                return FailureDecision.FAIL_FAST_SECURITY;
            }
            if (status == 404) {
                return FailureDecision.FAIL_FAST_NOT_FOUND;
            }
        }

        if (error instanceof SdkClientException) {
            return FailureDecision.RETRY_WITH_BACKOFF;
        }

        return FailureDecision.FAIL_FAST_UNKNOWN;
    }
}
```

Test the classification directly.

---

## 11. Replay Testing

### 11.1 Why replay matters

In event-driven systems, production failures often become DLQ messages. The operational question becomes:

> “Can we safely replay this message after fixing the issue?”

Replay safety must be designed and tested.

A replay-safe handler has these properties:

- Idempotent side effects.
- Stable idempotency key.
- Monotonic state transition.
- Duplicate event detection.
- Safe external call behavior.
- Clear audit trail.

---

### 11.2 Replay test example

```java
@Test
void replayingSameCaseSubmittedEventDoesNotCreateDuplicateAssignment() {
    CaseSubmittedEvent event = new CaseSubmittedEvent(
            "evt-123",
            "CASE-123",
            "CEA",
            Instant.parse("2026-06-19T10:15:30Z")
    );

    handler.handle(event);
    handler.handle(event);

    assertEquals(1, assignmentRepository.findByCaseId("CASE-123").size());
    assertTrue(idempotencyRepository.exists("evt-123"));
}
```

This is more important than checking whether `sqs.receiveMessage()` works. SQS can deliver duplicates; your system must survive duplicates.

---

### 11.3 Production event fixture replay

A mature team keeps sanitized production event samples:

```text
src/test/resources/replay/sqs/case-submitted-duplicate.json
src/test/resources/replay/sqs/case-submitted-old-version.json
src/test/resources/replay/sqs/case-submitted-missing-optional-field.json
src/test/resources/replay/sqs/case-submitted-malformed-agency.json
```

Rules:

- Redact PII/secrets.
- Preserve structure.
- Preserve edge case.
- Link fixture to incident or defect ID.
- Add regression test.

Incident-driven test fixtures are a strong sign of engineering maturity.

---

## 12. Golden Payload Testing

### 12.1 What is a golden payload?

A golden payload is a canonical JSON payload stored in source control and compared against generated output.

Example:

```text
src/test/resources/golden/case-submitted-event-v1.json
```

Test:

```java
@Test
void caseSubmittedEventPayloadMatchesContract() throws Exception {
    CaseSubmittedEvent event = new CaseSubmittedEvent(
            "evt-123",
            "CASE-123",
            "CEA",
            Instant.parse("2026-06-19T10:15:30Z")
    );

    String actual = jsonCodec.toPrettyJson(event);
    String expected = Files.readString(Path.of(
            "src/test/resources/golden/case-submitted-event-v1.json"
    ));

    assertEquals(normalizeJson(expected), normalizeJson(actual));
}
```

Golden tests are useful for messages published to SNS/SQS/EventBridge and for JSON uploaded to S3.

---

### 12.2 Golden test anti-patterns

Avoid golden tests for everything. They become noisy if used for unstable formatting.

Good targets:

- Public event payloads.
- Cross-service contracts.
- Audit records.
- Regulatory evidence documents.
- API payloads consumed by external systems.

Poor targets:

- Internal debug logs.
- Unstable timestamp-heavy payloads without normalization.
- Payloads with random ordering.

---

## 13. Environment Configuration Testing

### 13.1 Configuration is part of behavior

AWS-integrated apps fail frequently because configuration differs between environments:

- Wrong region.
- Wrong queue URL.
- Wrong bucket name.
- Wrong secret name.
- Wrong endpoint override.
- Wrong IAM role.
- Wrong KMS key.
- Missing VPC endpoint.

Therefore configuration should be validated.

---

### 13.2 Startup validation

At startup, a Java service can validate required configuration before serving traffic.

Example:

```java
record AwsIntegrationConfig(
        Region region,
        String documentBucket,
        String caseEventsQueueUrl,
        String databaseSecretId,
        Optional<URI> endpointOverride
) {
    AwsIntegrationConfig {
        requireNonBlank(documentBucket, "documentBucket");
        requireNonBlank(caseEventsQueueUrl, "caseEventsQueueUrl");
        requireNonBlank(databaseSecretId, "databaseSecretId");

        endpointOverride.ifPresent(uri -> {
            if (isProduction() && isLocalEndpoint(uri)) {
                throw new IllegalStateException("Local endpoint override is forbidden in production");
            }
        });
    }
}
```

---

### 13.3 Environment matrix test

Maintain a config matrix:

| Property | Local | CI emulator | Sandbox AWS | UAT | PROD |
|---|---|---|---|---|---|
| Region | ap-southeast-1 | ap-southeast-1 | ap-southeast-1 | ap-southeast-1 | ap-southeast-1 |
| Endpoint override | localhost | container endpoint | none | none | none |
| Credentials | dummy | dummy | CI role | UAT role | prod role |
| S3 bucket | local bucket | test bucket | sandbox bucket | uat bucket | prod bucket |
| SQS queue | local queue | test queue | sandbox queue | uat queue | prod queue |

Test that illegal combinations fail.

---

## 14. CI/CD Strategy

### 14.1 Recommended CI stages

```text
Stage 1 — Compile + static checks
Stage 2 — Pure unit tests
Stage 3 — Adapter tests with mocked SDK clients
Stage 4 — Emulator integration tests
Stage 5 — Package artifact
Stage 6 — Deploy to sandbox
Stage 7 — Real AWS integration tests
Stage 8 — Security/IAM/config checks
Stage 9 — Promote to UAT/PROD with approval gates
```

Not every commit must deploy to sandbox. But at least main branch should regularly validate against real AWS.

---

### 14.2 Test tagging

Use JUnit tags:

```java
@Tag("unit")
class S3ObjectKeyPolicyTest {}

@Tag("localstack")
class SqsLocalStackIntegrationTest {}

@Tag("aws-integration")
class S3RealAwsIntegrationTest {}
```

Maven profiles:

```xml
<profiles>
    <profile>
        <id>unit</id>
        <properties>
            <groups>unit</groups>
        </properties>
    </profile>

    <profile>
        <id>localstack</id>
        <properties>
            <groups>localstack</groups>
        </properties>
    </profile>

    <profile>
        <id>aws-integration</id>
        <properties>
            <groups>aws-integration</groups>
        </properties>
    </profile>
</profiles>
```

Or Gradle:

```kotlin
tasks.test {
    useJUnitPlatform {
        excludeTags("aws-integration")
    }
}

tasks.register<Test>("awsIntegrationTest") {
    useJUnitPlatform {
        includeTags("aws-integration")
    }
}
```

---

## 15. Test Data Management

### 15.1 Test data must be isolated

AWS service state can outlive the test process. Therefore test data must be uniquely identifiable.

Use:

- Unique prefixes.
- Unique queue/topic names.
- Unique message IDs.
- Unique correlation IDs.
- Unique S3 object keys.
- Resource tags.

Example S3 key:

```text
integration-test/run=20260619-a8f3/case=CASE-123/document=DOC-456/original/evidence.pdf
```

---

### 15.2 Never test with production data

Production payload replay must be sanitized. Never copy real production secrets, personal data, or regulated records into test fixtures.

Recommended approach:

1. Capture failing payload metadata.
2. Redact sensitive fields.
3. Preserve shape and edge case.
4. Store sanitized fixture.
5. Add regression test.

---

## 16. Testing Secrets and Parameters

### 16.1 What to test

For Secrets Manager and SSM Parameter Store:

- Correct name/path.
- Correct permission.
- Missing value behavior.
- Invalid JSON behavior.
- Version/stage behavior for secrets.
- Cache refresh behavior.
- Redaction behavior.
- Startup failure vs lazy failure.

---

### 16.2 Secret adapter test

Port:

```java
interface DatabaseCredentialProvider {
    DatabaseCredential currentCredential();
}
```

Adapter should parse secret JSON and hide raw secret values from logs.

Example test cases:

```text
- valid secret JSON returns credential
- missing username fails startup
- missing password fails startup
- malformed JSON fails safely
- AccessDenied maps to security misconfiguration
- ResourceNotFound maps to missing configuration
- secret value is not included in exception message
```

The last one is crucial.

---

## 17. Testing S3 Pipelines

### 17.1 What to test for S3

For S3 integration:

- Key naming.
- Metadata.
- Content type.
- Checksum/integrity.
- Empty file.
- Large file.
- Multipart upload failure.
- Abort multipart upload.
- Missing object.
- Access denied.
- Versioning if enabled.
- Encryption settings.
- Lifecycle assumptions.

---

### 17.2 Large file test without huge repository files

Generate file content dynamically:

```java
Path tempFile = Files.createTempFile("large-s3-test", ".bin");
try (OutputStream out = Files.newOutputStream(tempFile)) {
    byte[] block = new byte[1024 * 1024];
    new Random(123).nextBytes(block);

    for (int i = 0; i < 100; i++) {
        out.write(block);
    }
}
```

This produces a 100 MB file without storing it in Git.

---

### 17.3 S3 invariant tests

Important invariants:

- A failed validation must not upload an object.
- A failed metadata write after upload must leave object in quarantine or be compensated.
- An uploaded object must be traceable by correlation ID.
- A duplicate upload request must not create conflicting state.
- A large object must not be loaded fully into heap unless explicitly allowed.

---

## 18. Testing SQS Consumers

### 18.1 What to test

For SQS consumers:

- Long polling configuration.
- Batch size.
- Message parsing.
- Per-message failure.
- Delete only after successful processing.
- Visibility timeout extension.
- Duplicate message idempotency.
- Poison message path.
- DLQ assumptions.
- Graceful shutdown.
- Backpressure.

---

### 18.2 Delete-after-success invariant

The consumer must not delete a message before durable side effects are complete.

Bad flow:

```text
receive message
↓
delete message
↓
process business operation
↓
crash
```

Correct flow:

```text
receive message
↓
process business operation
↓
commit durable state / idempotency record
↓
delete message
```

Test this by injecting failure before and after processing.

---

## 19. Testing SNS Publishing and Fan-Out

### 19.1 What to test

For SNS:

- Topic ARN configuration.
- Message body schema.
- Message attributes.
- Filter policy compatibility.
- Fan-out to SQS.
- Subscriber isolation.
- Publish failure handling.
- Duplicate publish idempotency at consumer side.
- Large payload strategy.

SNS is often treated as “fire and forget”. That is dangerous. Publishing is an external side effect and must be observable and failure-aware.

---

## 20. Testing Observability

### 20.1 Logs are testable

For critical flows, test that logs include:

- Correlation ID.
- Event ID.
- Case ID or safe business key.
- AWS service name.
- AWS operation.
- AWS request ID where available.
- Failure classification.
- Retry decision.

But logs must not include:

- Secret values.
- Full tokens.
- Raw passwords.
- Unnecessary personal data.

---

### 20.2 Metrics are testable

A good AWS adapter emits metrics such as:

```text
aws.s3.put_object.success
aws.s3.put_object.failure
aws.s3.put_object.latency
aws.sqs.receive.count
aws.sqs.message.processed
aws.sqs.message.failed
aws.sqs.message.duplicate
aws.sns.publish.success
aws.secrets.cache.hit
aws.secrets.cache.miss
```

In unit tests, inject a fake metric recorder and assert metric events.

---

## 21. Testing Time

Time is everywhere in AWS integration:

- SQS visibility timeout.
- Secret cache TTL.
- Presigned URL expiry.
- Lambda timeout.
- Event age.
- DLQ retention.
- Retry backoff.
- Token expiry.

Never hide time behind `Instant.now()` everywhere. Use `Clock`.

Example:

```java
final class SecretCache {
    private final Clock clock;
    private final Duration ttl;
    private volatile CachedSecret cached;

    SecretCache(Clock clock, Duration ttl) {
        this.clock = clock;
        this.ttl = ttl;
    }

    boolean isExpired() {
        return cached == null || cached.loadedAt().plus(ttl).isBefore(clock.instant());
    }
}
```

This makes TTL behavior testable without sleeping.

---

## 22. Java 8 to Java 25 Considerations

### 22.1 Java 8 compatibility

If supporting Java 8:

- Avoid APIs introduced after Java 8 in shared code.
- Use older compatible dependency versions if needed.
- Be careful with TLS/certificate behavior on old JVMs.
- Watch for lower performance and older GC behavior.
- Avoid relying on records, switch expressions, virtual threads, or newer APIs.

### 22.2 Java 17/21/25 advantages

With newer Java versions:

- Better GC options.
- Better TLS and crypto defaults.
- Better container awareness.
- Records for config and immutable messages.
- Virtual threads may help blocking integration code in some service designs.
- Better language ergonomics for sealed result types and pattern matching, depending on target version.

But be careful:

> New Java features do not remove AWS distributed systems failure modes.

Virtual threads do not fix missing timeouts. Records do not fix bad event versioning. Pattern matching does not fix IAM over-permission.

---

## 23. Common Anti-Patterns

### 23.1 “Mock everything”

Fast, but gives false confidence. You may never notice wrong endpoint, wrong IAM, wrong KMS, wrong event source mapping, or wrong queue policy.

### 23.2 “Use LocalStack for everything”

Better than only mocks, but still not real AWS. Use it for fast feedback, not final proof.

### 23.3 “Use real AWS for every test”

Slow, expensive, sometimes flaky, and harder to run per commit. Use real AWS strategically.

### 23.4 “Test happy path only”

Most AWS production incidents happen in failure paths: retries, throttling, duplicate messages, access denied, timeout, or partial success.

### 23.5 “No cleanup strategy”

Cloud resources leak. Leaked resources cost money and pollute later tests.

### 23.6 “Tests use developer credentials”

CI tests must assume a controlled role. Local development may use profiles, but tests should not depend on one engineer’s laptop credentials.

### 23.7 “Endpoint override accidentally enabled in production”

Local endpoint override must be impossible in production configuration.

### 23.8 “No deny tests”

Allow tests prove required permission exists. Deny tests prove least privilege exists.

### 23.9 “DLQ exists, therefore reliable”

DLQ is storage for failed messages. It is not a recovery strategy by itself. You need triage, replay, idempotency, and audit.

---

## 24. Production-Grade Test Matrix

Use this as a practical matrix.

| Concern | Unit | Mock adapter | Emulator | Real AWS sandbox | UAT/prod smoke |
|---|---:|---:|---:|---:|---:|
| Business rules | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Request construction | ❌ | ✅ | ✅ | ✅ | ⚠️ |
| Serialization | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| IAM allow | ❌ | ❌ | ❌ | ✅ | ✅ |
| IAM deny | ❌ | ❌ | ❌ | ✅ | ⚠️ |
| KMS policy | ❌ | ❌ | ❌ | ✅ | ✅ |
| S3 basic put/get | ❌ | ⚠️ | ✅ | ✅ | ⚠️ |
| S3 event notification | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| SQS duplicate handling | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| SQS real delivery behavior | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| SNS fan-out | ❌ | ❌ | ✅ | ✅ | ✅ |
| Lambda handler logic | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| Lambda event source mapping | ❌ | ❌ | ❌ | ✅ | ✅ |
| CloudWatch observability | ❌ | ⚠️ | ❌ | ✅ | ✅ |
| Cost/quota | ❌ | ❌ | ❌ | ✅ | ✅ |

Legend:

```text
✅ strong fit
⚠️ partial fit
❌ poor fit
```

---

## 25. Recommended Repository Layout

A production Java service can structure AWS tests like this:

```text
src/main/java
└── com.example.caseplatform
    ├── domain
    ├── application
    ├── aws
    │   ├── s3
    │   ├── sqs
    │   ├── sns
    │   ├── secrets
    │   └── config
    └── bootstrap

src/test/java
└── com.example.caseplatform
    ├── domain
    ├── application
    ├── aws
    │   ├── s3
    │   ├── sqs
    │   ├── sns
    │   └── secrets
    └── testkit

src/test/resources
├── events
├── golden
├── replay
└── localstack

src/integrationTest/java
└── com.example.caseplatform
    ├── localstack
    └── aws
```

Testkit components:

```text
TestAwsClientFactory
TestSqsEvents
TestSnsEvents
TestS3Objects
FakeClock
FakeMetricRecorder
FakeAuditSink
LocalStackExtension
AwsSandboxResourceManager
```

---

## 26. A Practical Step-by-Step Strategy

### Step 1 — Define application-owned AWS ports

Examples:

```text
CaseDocumentStore
CaseEventPublisher
CaseEventConsumer
RuntimeSecretProvider
ParameterProvider
AuditEventSink
IdempotencyStore
```

### Step 2 — Keep domain tests AWS-free

Do not import AWS SDK types into domain tests.

### Step 3 — Test adapters with mocked SDK clients

Validate request construction and error mapping.

### Step 4 — Add LocalStack/Testcontainers tests

Validate local integration flow for common services.

### Step 5 — Add real AWS sandbox tests

Validate IAM, KMS, policies, event routing, and real service behavior.

### Step 6 — Add replay fixtures

Every production edge case should become a regression fixture.

### Step 7 — Add observability assertions

Critical flows should emit expected logs/metrics/traces.

### Step 8 — Add cleanup and janitor

Cloud test resources must be tagged and cleaned.

### Step 9 — Gate promotion

Do not promote to UAT/prod if sandbox integration, IAM checks, or config validation fail.

---

## 27. Engineering Checklist

Before considering your AWS-integrated Java service production-ready, ask:

### Design

- [ ] Are AWS SDK types kept out of the domain layer?
- [ ] Are AWS calls behind application-owned ports/adapters?
- [ ] Is endpoint override impossible in production?
- [ ] Is region explicit and validated?
- [ ] Are credentials resolved through runtime identity, not static keys?

### Unit and adapter tests

- [ ] Are key naming rules tested?
- [ ] Are event schemas tested?
- [ ] Are request attributes tested?
- [ ] Are AWS exceptions mapped correctly?
- [ ] Are retry classifications tested?
- [ ] Are secrets redacted in errors/logs?

### Emulator tests

- [ ] Do LocalStack tests run in CI?
- [ ] Are S3/SQS/SNS/Secrets/SSM basic flows covered?
- [ ] Are resources created per test run?
- [ ] Is test data isolated?

### Real AWS tests

- [ ] Are IAM allow paths tested?
- [ ] Are IAM deny paths tested?
- [ ] Is KMS behavior tested?
- [ ] Are event source mappings tested?
- [ ] Are CloudWatch logs/metrics verified?
- [ ] Are resources tagged and cleaned?

### Event-driven behavior

- [ ] Are duplicate messages tested?
- [ ] Are out-of-order events tested?
- [ ] Are poison messages tested?
- [ ] Is DLQ replay tested?
- [ ] Is idempotency tested?

### Operations

- [ ] Is there a runbook for failed integration tests?
- [ ] Is there a janitor for stale test resources?
- [ ] Is test cost monitored?
- [ ] Are production smoke tests minimal and safe?

---

## 28. Top 1% Takeaways

The difference between average and elite AWS-integrated Java engineering is not that elite engineers write more mocks.

It is that they understand what each test environment can and cannot prove.

A strong mental model:

```text
Pure unit tests prove local rules.
Mocked adapter tests prove request construction and error mapping.
Emulator tests prove local integration flow.
Real AWS sandbox tests prove cloud behavior, IAM, KMS, and routing.
Production smoke tests prove the deployed artifact can execute minimal safe behavior.
Replay tests prove the system can recover from real failures.
```

The most dangerous testing mistake is false confidence.

False confidence appears when:

- Mocks say everything is fine but IAM fails in production.
- LocalStack passes but KMS policy fails in UAT.
- Happy-path tests pass but duplicate SQS messages corrupt state.
- Lambda handler tests pass but event source mapping retries the wrong batch.
- Integration tests pass but no one can debug the failure because logs have no correlation ID.

The top-tier engineer designs tests around invariants:

- A message is deleted only after durable success.
- A duplicate event does not duplicate side effects.
- A missing permission fails fast and visibly.
- A local endpoint cannot be used in production.
- A secret is never logged.
- A failed upload is either absent, quarantined, or compensated.
- A DLQ message can be replayed safely.
- An event schema can evolve without breaking consumers.

That is the real purpose of local development, testing, and emulation strategy.

---

## 29. References

- AWS SDK for Java 2.x Developer Guide — Using the SDK, clients, requests, responses, errors, paginators, waiters, and performance concepts.
- AWS SDK for Java 2.x Developer Guide — Endpoint configuration and `endpointOverride` for custom/local endpoints.
- AWS Lambda Developer Guide — Java Lambda functions and testing/invocation concepts.
- AWS Lambda Java Libraries — `aws-lambda-java-events` and `aws-lambda-java-tests` for Java event testing.
- Testcontainers LocalStack module documentation.
- LocalStack AWS SDK Java integration documentation.
- AWS Well-Architected Framework — operational excellence, reliability, security, performance efficiency, cost optimization.

---

## 30. What Comes Next

Next part:

```text
Part 8 — S3 Fundamentals for Java Engineers
```

Part 8 will move from general testing strategy into S3 specifically: bucket/object model, key design, metadata, versioning, consistency, encryption, presigned URL, checksum, lifecycle, and the difference between object storage and filesystem thinking.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-06-observability-for-java-aws-integration.md">⬅️ Part 6 — Observability for Java AWS Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-08-s3-fundamentals-for-java-engineers.md">Part 8 — S3 Fundamentals for Java Engineers ➡️</a>
</div>
