# Strict Coding Standards — Java gRPC

Status: mandatory standard for LLM-generated Java code  
Scope: gRPC Java clients, servers, generated stubs, protobuf contracts, RPC error mapping, deadlines, cancellation, metadata, streaming, interceptors, observability, and service-to-service RPC integrations  
Applies with: `strict-coding-standards__java11.md`, `java17.md`, `java21.md`, `java25.md`, `java_concurrency.md`, `java_network.md`, `java_security.md`, `java_cryptography.md`, and project-specific protobuf/build standards

---

## 1. Core Contract

gRPC code MUST be contract-first, deadline-aware, cancellation-aware, and backward-compatible.

LLM-generated gRPC code MUST explicitly define:

1. `.proto` service and message contract;
2. RPC type: unary, server streaming, client streaming, or bidirectional streaming;
3. deadline policy;
4. cancellation behavior;
5. retry/hedging policy;
6. idempotency semantics;
7. metadata policy;
8. authentication/authorization boundary;
9. status code mapping;
10. protobuf evolution strategy;
11. observability contract;
12. test strategy.

If any of those are unknown, the LLM MUST avoid inventing behavior and use safe defaults: no retry, bounded deadline, no streaming, explicit error mapping, no sensitive metadata logging.

---

## 2. gRPC Is RPC, Not REST-over-Protobuf

Do not model gRPC by copying HTTP resource design mechanically.

gRPC services expose remote procedures over typed contracts. They are best for:

- internal service-to-service communication;
- strongly typed contracts;
- low-latency binary communication;
- streaming workflows;
- generated clients;
- controlled consumers.

Do not choose gRPC when:

- browser/native HTTP cache semantics are required;
- public third-party API ergonomics are more important than typed RPC;
- human-debuggable JSON is required;
- infrastructure cannot handle HTTP/2;
- independent clients cannot consume protobuf/tooling.

---

## 3. Proto Contract Rules

### 3.1 Proto file layout

Required:

```proto
syntax = "proto3";

package com.example.case.v1;

option java_multiple_files = true;
option java_package = "com.example.case.v1";
option java_outer_classname = "CaseServiceProto";
```

Rules:

- package MUST include a version segment for externally consumed APIs or independently deployed clients.
- `java_package` MUST be stable and must not expose temporary/internal module names.
- `java_multiple_files = true` SHOULD be used unless project convention differs.
- generated code MUST NOT be manually edited.
- `.proto` files MUST be reviewed as public contracts.

### 3.2 Naming rules

Follow protobuf style:

- file names: `lower_snake_case.proto`;
- package names: lowercase dot-separated;
- message names: `UpperCamelCase`;
- field names: `lower_snake_case`;
- enum names: `UpperCamelCase`;
- enum values: `UPPER_SNAKE_CASE`;
- service names: `UpperCamelCase`;
- RPC names: `UpperCamelCase` verbs.

Allowed:

```proto
service CaseCommandService {
  rpc SubmitCase(SubmitCaseRequest) returns (SubmitCaseResponse);
}
```

Forbidden:

```proto
service case_service {
  rpc submit_case(CaseEntity) returns (CaseEntity);
}
```

---

## 4. Protobuf Evolution Rules

Backward compatibility is mandatory.

### 4.1 Field numbers

Rules:

- Never reuse field numbers.
- Never reuse removed field names without checking JSON/text compatibility impact.
- Always reserve removed field numbers.
- Prefer adding optional/new fields over changing existing meaning.
- Do not change field type unless wire-compatible and explicitly reviewed.
- Do not change field semantics silently.

Required when removing a field:

```proto
message CaseSnapshot {
  reserved 7, 9;
  reserved "legacy_owner_name";

  string case_id = 1;
  string status = 2;
}
```

Forbidden:

```proto
// Old:
string status = 2;

// New, forbidden without versioning:
int32 status = 2;
```

### 4.2 Optional and presence

Rules:

- Use `optional` when presence matters.
- Do not infer missing vs default value unless contract explicitly supports it.
- Wrapper types may be used when interop or nullability semantics require them.
- For patch/update RPCs, use explicit field masks or patch messages rather than guessing defaults.

### 4.3 Enums

Required:

```proto
enum CaseStatus {
  CASE_STATUS_UNSPECIFIED = 0;
  CASE_STATUS_DRAFT = 1;
  CASE_STATUS_SUBMITTED = 2;
  CASE_STATUS_APPROVED = 3;
}
```

Rules:

- enum zero value MUST be `*_UNSPECIFIED` or equivalent.
- clients/servers MUST handle unknown enum values safely.
- do not reuse enum numeric values.
- reserve removed enum values/names.

---

## 5. Service and RPC Design

### 5.1 Service boundary

A gRPC service MUST represent a cohesive capability, not a random collection of methods.

Allowed:

```proto
service CaseQueryService {
  rpc GetCase(GetCaseRequest) returns (GetCaseResponse);
  rpc SearchCases(SearchCasesRequest) returns (SearchCasesResponse);
}

service CaseCommandService {
  rpc SubmitCase(SubmitCaseRequest) returns (SubmitCaseResponse);
  rpc ApproveCase(ApproveCaseRequest) returns (ApproveCaseResponse);
}
```

Forbidden:

```proto
service CommonService {
  rpc DoEverything(GenericRequest) returns (GenericResponse);
}
```

### 5.2 RPC request/response messages

Every RPC MUST have dedicated request and response messages, even if currently empty.

Allowed:

```proto
message GetCaseRequest {
  string case_id = 1;
}

message GetCaseResponse {
  CaseSnapshot case = 1;
}
```

Forbidden:

```proto
rpc GetCase(StringValue) returns (CaseSnapshot);
```

Reason: dedicated messages allow backward-compatible addition of fields.

### 5.3 Avoid generic maps

Generic `map<string, string>` and `Struct` are restricted.

Allowed only for:

- truly dynamic metadata;
- pass-through provider attributes;
- observability tags;
- temporary migration with expiration.

Forbidden as domain model substitute:

```proto
message GenericEntity {
  map<string, string> fields = 1;
}
```

---

## 6. RPC Type Selection

| RPC type | Use when | Restrictions |
|---|---|---|
| Unary | single request/response | default choice |
| Server streaming | server emits many results over time | requires flow-control and cancellation handling |
| Client streaming | client uploads many messages then gets one result | requires max size/count and cancellation handling |
| Bidirectional streaming | interactive protocol | restricted; requires protocol state machine documentation |

Rules:

- Default to unary.
- Do not use streaming just to return a list unless list may be large/continuous or latency benefits are real.
- Streaming RPCs MUST define ordering, termination, cancellation, backpressure, and error semantics.
- Bidirectional streaming MUST include a state diagram or protocol note.

---

## 7. Deadline Rules

Every outbound gRPC call MUST have a deadline.

Allowed Java client style:

```java
CaseServiceGrpc.CaseServiceBlockingStub stubWithDeadline = stub
        .withDeadlineAfter(2, TimeUnit.SECONDS);

GetCaseResponse response = stubWithDeadline.getCase(request);
```

Rules:

- Do not rely on infinite/default deadlines.
- Deadline must be chosen per operation class.
- Deadline must be shorter than caller/user request budget when nested.
- Server code MUST check cancellation/deadline for long-running work.
- Downstream calls MUST receive remaining budget where framework supports propagation.
- Deadline exceeded must map to a domain/upstream timeout failure, not generic unknown error.

Forbidden:

```java
stub.getCase(request); // no deadline in production integration code
```

---

## 8. Cancellation Rules

Cancellation is part of the protocol.

Server handlers MUST stop expensive work when the call is cancelled or deadline expires.

Required for long-running methods:

- periodically check cancellation/deadline;
- cancel downstream work;
- close resources;
- stop emitting stream messages;
- avoid writing after cancellation;
- make cleanup idempotent.

Forbidden:

- ignoring cancellation while continuing database polling;
- continuing large computation after client deadline expired;
- swallowing cancellation and returning success;
- mapping client cancellation to internal server error.

---

## 9. Status Code Mapping

All gRPC errors MUST map to stable `Status` codes.

| Condition | gRPC status |
|---|---|
| invalid request shape/field value | `INVALID_ARGUMENT` |
| missing authentication | `UNAUTHENTICATED` |
| authenticated but not authorized | `PERMISSION_DENIED` |
| resource absent | `NOT_FOUND` |
| duplicate/already exists | `ALREADY_EXISTS` |
| optimistic/state conflict | `ABORTED` or `FAILED_PRECONDITION` based on semantics |
| business precondition not met | `FAILED_PRECONDITION` |
| rate/quota exceeded | `RESOURCE_EXHAUSTED` |
| client cancelled | `CANCELLED` |
| deadline exceeded | `DEADLINE_EXCEEDED` |
| temporary dependency unavailable | `UNAVAILABLE` |
| unimplemented RPC | `UNIMPLEMENTED` |
| unexpected bug | `INTERNAL` |
| unknown upstream failure | `UNKNOWN` only if no better mapping exists |

Rules:

- Do not map everything to `UNKNOWN` or `INTERNAL`.
- Do not expose stack traces in status description.
- Do not put sensitive information in error metadata.
- Rich error details MAY be used if all clients support them.

Allowed:

```java
throw Status.NOT_FOUND
        .withDescription("case not found")
        .asRuntimeException();
```

Forbidden:

```java
throw Status.UNKNOWN
        .withDescription(exception.toString())
        .asRuntimeException();
```

---

## 10. Metadata Rules

Metadata is not a dumping ground.

Allowed metadata:

- authentication token/credentials via approved mechanism;
- correlation/trace IDs;
- tenant/context identifiers if verified;
- request IDs;
- feature flags only if platform-approved;
- idempotency keys.

Forbidden metadata:

- raw passwords;
- refresh tokens;
- PII not needed for routing/security;
- serialized JSON blobs as hidden request body;
- business data that belongs in protobuf message;
- unbounded metadata values.

Rules:

- Metadata keys and propagation must be allow-listed.
- Binary metadata must use `-bin` suffix according to gRPC convention.
- Do not log metadata wholesale.
- Do not trust inbound metadata without authentication/authorization validation.

---

## 11. Channel and Stub Lifecycle

### 11.1 ManagedChannel

Rules:

- `ManagedChannel` is expensive and should be reused per target/service policy.
- Do not create a new channel per RPC.
- Channel lifecycle must be owned by application/container/client factory.
- Shutdown must be graceful.
- TLS/plaintext must be explicit.
- Load balancing/name resolution must be configured intentionally.

Forbidden:

```java
ManagedChannel channel = ManagedChannelBuilder.forAddress(host, port)
        .usePlaintext()
        .build();
return MyServiceGrpc.newBlockingStub(channel).call(request); // per-call channel leak
```

Allowed:

```java
final class CaseGrpcClient implements AutoCloseable {
    private final ManagedChannel channel;
    private final CaseServiceGrpc.CaseServiceBlockingStub stub;

    CaseGrpcClient(String host, int port) {
        this.channel = ManagedChannelBuilder.forAddress(host, port)
                .useTransportSecurity()
                .build();
        this.stub = CaseServiceGrpc.newBlockingStub(channel);
    }

    @Override
    public void close() throws InterruptedException {
        channel.shutdown();
        if (!channel.awaitTermination(5, TimeUnit.SECONDS)) {
            channel.shutdownNow();
        }
    }
}
```

### 11.2 Stub usage

Rules:

- Stubs are lightweight views over a channel and may be configured per call.
- Use `withDeadlineAfter`, `withCallCredentials`, or interceptors intentionally.
- Do not mutate global client state per request.
- Do not share request-specific metadata through static fields or thread locals unless framework standardizes it.

---

## 12. Retry and Hedging

Retry is forbidden by default unless explicitly configured and justified.

Required for retry:

1. method is idempotent or deduplicated;
2. retryable status codes are defined;
3. max attempts are bounded;
4. backoff is exponential with jitter;
5. total deadline is bounded;
6. server pushback/throttling is respected where configured;
7. metrics show attempts;
8. duplicate side effects are impossible or acceptable.

Usually retryable:

- `UNAVAILABLE` for idempotent reads;
- selected `DEADLINE_EXCEEDED` only if server-side side effects are known safe;
- transient transport errors before server processing.

Never blindly retry:

- command RPC without idempotency key;
- payment/approval/submission mutation;
- `INVALID_ARGUMENT`;
- `PERMISSION_DENIED`;
- `UNAUTHENTICATED` without credential refresh policy;
- `FAILED_PRECONDITION` requiring user/domain action.

Hedging is restricted and requires architecture approval because it intentionally creates duplicate in-flight calls.

---

## 13. Streaming Rules

### 13.1 General streaming contract

Streaming RPCs MUST document:

- message ordering;
- max message size;
- max stream duration;
- heartbeat/keepalive behavior;
- cancellation behavior;
- backpressure handling;
- error semantics;
- final status behavior;
- reconnection/resume behavior if applicable.

### 13.2 Server streaming

Rules:

- Do not read entire dataset into memory before streaming.
- Stop producing when client cancels.
- Bound database/file/network resources.
- Respect outbound flow-control readiness where using async APIs.
- Map partial failure explicitly.

### 13.3 Client streaming

Rules:

- Validate each message.
- Enforce max count/bytes/time.
- Do not accumulate unbounded messages in memory.
- Define atomicity: all-or-nothing vs partial acceptance.
- Define duplicate message behavior.

### 13.4 Bidirectional streaming

Bidirectional streaming requires a protocol state machine.

Required document:

```text
State: CONNECTED -> AUTHENTICATED -> ACTIVE -> DRAINING -> CLOSED
Allowed messages per state:
Failure transitions:
Cancellation behavior:
Ordering guarantee:
Backpressure strategy:
```

Forbidden:

- ad-hoc chatty protocol without state model;
- unbounded queue between inbound and outbound stream;
- ignoring `onError`/`onCompleted` lifecycle;
- emitting after terminal signal.

---

## 14. Authentication and Authorization

Rules:

- Use TLS/mTLS or platform-approved security transport for production.
- Use call credentials/interceptors for authentication where appropriate.
- Authorization MUST be checked server-side per RPC/action/resource.
- Do not trust user/tenant IDs from request message alone.
- Do not log authorization metadata.
- Do not use plaintext channel in production except explicitly approved private/test environment.

Forbidden:

```java
ManagedChannelBuilder.forAddress(host, port).usePlaintext(); // production default
```

---

## 15. Interceptors

Interceptors are allowed for cross-cutting concerns only.

Allowed:

- authentication extraction;
- authorization context setup;
- deadline/correlation propagation;
- metrics;
- tracing;
- safe logging;
- request size checks;
- tenant context validation.

Forbidden:

- business logic hidden in interceptor;
- database writes in generic interceptor;
- swallowing errors and returning success;
- adding metadata to bypass authorization;
- logging raw request/metadata.

Rules:

- Interceptor order must be deterministic.
- Interceptors must be tested independently.
- Interceptors must not depend on mutable static state.

---

## 16. Protobuf Message Design

### 16.1 Domain vs transport model

Generated protobuf classes MUST NOT become domain aggregates.

Allowed mapping:

```text
protobuf request -> application command -> domain model -> protobuf response
```

Forbidden:

```text
protobuf message -> JPA entity merge
protobuf message -> domain aggregate with generated setters everywhere
```

### 16.2 IDs

Rules:

- Use string IDs when identifiers are externally meaningful or non-numeric.
- Use numeric IDs only when stable across systems and not database-internal leakage.
- Validate ID format at boundary.

### 16.3 Money and decimal

Rules:

- Do not use `double`/`float` for money.
- Prefer minor-unit integer + currency, or documented decimal representation.
- For arbitrary precision decimal, use string plus validation or a standard decimal message if project has one.

### 16.4 Time

Rules:

- Use `google.protobuf.Timestamp` for instants.
- Use explicit date message/string convention for date-only values.
- Do not encode local timezone assumptions in timestamp fields.
- Preserve timezone intent when business semantics require it.

---

## 17. Size and Resource Limits

Every gRPC service/client MUST have resource limits.

Required policies:

- max inbound message size;
- max outbound message size;
- max stream duration;
- max concurrent streams/calls;
- deadline budget;
- server thread/executor policy;
- backpressure strategy;
- memory budget for aggregation.

Forbidden:

- unbounded stream aggregation;
- unlimited message size;
- loading large export into one protobuf message;
- returning huge repeated field instead of pagination/streaming.

---

## 18. Observability

Required metrics/log fields:

- service name;
- method name;
- status code;
- duration;
- deadline exceeded count;
- cancellation count;
- retry attempts;
- payload size class;
- stream message counts;
- remote target;
- correlation/trace ID.

Forbidden logs:

- raw metadata;
- auth tokens;
- full protobuf payload containing PII/secrets;
- stack trace in client-visible status description;
- binary payload dumps.

Tracing MUST propagate context using project-approved metadata keys.

---

## 19. Health Checking and Readiness

gRPC servers SHOULD expose standard health checking when used behind service discovery/load balancing.

Rules:

- health must reflect dependency/readiness policy accurately;
- liveness must not require all downstream dependencies to be healthy;
- readiness may include critical dependencies;
- do not return healthy while server cannot accept meaningful RPCs.

---

## 20. Keepalive

Keepalive is restricted.

Rules:

- Do not enable aggressive keepalive by default.
- Coordinate keepalive settings with load balancer/proxy/server policies.
- Do not use keepalive to mask missing deadlines or bad connection lifecycle.
- Document interval, timeout, and permit-without-calls behavior.

---

## 21. Java Concurrency and Executor Rules

Rules:

- Server handlers must avoid blocking event-loop or transport threads.
- Blocking database/file/network calls must run on appropriate executor/container thread model.
- Do not use unbounded executors.
- Propagate cancellation to futures/tasks.
- Do not use static mutable shared state for request context.
- Virtual threads MAY be used only under Java 21+ project policy and must still respect downstream resource limits.

---

## 22. Testing Requirements

gRPC code MUST include tests for:

- proto compatibility rules;
- request validation;
- status mapping;
- deadline exceeded;
- cancellation;
- auth failure;
- authorization failure;
- metadata propagation/redaction;
- retry disabled/enabled behavior;
- streaming backpressure/cancellation for streaming RPCs;
- large message rejection;
- unknown enum/default handling;
- channel shutdown lifecycle;
- interceptor behavior.

Recommended test layers:

1. pure mapper tests;
2. service implementation tests;
3. in-process gRPC server/client tests;
4. contract compatibility tests for `.proto` changes;
5. integration tests against real transport/security where critical.

---

## 23. LLM gRPC Implementation Protocol

Before writing gRPC code, the LLM MUST answer internally:

1. Is this service public, internal, or generated provider API?
2. What is the `.proto` contract?
3. Is this unary or streaming?
4. What deadline applies?
5. Is cancellation handled?
6. Is the RPC idempotent?
7. Are retries allowed?
8. What status codes map to domain errors?
9. What metadata is accepted and propagated?
10. What authn/authz applies?
11. What fields are safe to add/change?
12. What tests prove compatibility and runtime behavior?

Safe defaults:

- unary, not streaming;
- explicit deadline;
- no retry;
- no plaintext in production;
- no raw metadata logging;
- dedicated request/response messages;
- reserve removed fields;
- explicit status mapping.

---

## 24. Forbidden Patterns

Forbidden by default:

- New `ManagedChannel` per call.
- Production plaintext channel without explicit approval.
- gRPC call without deadline.
- Retrying command RPC without idempotency/deduplication.
- Mapping all errors to `UNKNOWN` or `INTERNAL`.
- Putting stack traces or secrets into `Status.description`.
- Using protobuf generated classes as JPA entities or domain aggregates.
- Reusing protobuf field numbers.
- Removing fields without reserving numbers.
- Generic `Struct`/`map<string,string>` as domain model.
- Streaming without cancellation/backpressure policy.
- Bidirectional streaming without protocol state machine.
- Logging raw metadata or full sensitive messages.
- Blocking transport/event-loop threads.
- Swallowing `onError` or emitting after `onCompleted`.

---

## 25. Reviewer Checklist

A Java gRPC change is acceptable only if:

- [ ] `.proto` contract is dedicated, stable, and version-aware;
- [ ] request/response messages are explicit;
- [ ] field numbers are not reused;
- [ ] removed fields are reserved;
- [ ] enum zero values are safe;
- [ ] RPC type is justified;
- [ ] deadline exists for outbound calls;
- [ ] server cancellation is handled for long-running work;
- [ ] status mapping is explicit;
- [ ] retry policy is absent or justified;
- [ ] metadata policy is allow-listed;
- [ ] authn/authz boundary is clear;
- [ ] channel lifecycle is managed;
- [ ] streaming has flow-control/resource policy;
- [ ] logs redact secrets and payloads;
- [ ] tests cover success/failure/deadline/cancellation;
- [ ] project Java baseline is respected.

---

## 26. References

- gRPC Java basics: https://grpc.io/docs/languages/java/basics/
- gRPC core concepts: https://grpc.io/docs/what-is-grpc/core-concepts/
- gRPC deadlines: https://grpc.io/docs/guides/deadlines/
- gRPC cancellation: https://grpc.io/docs/guides/cancellation/
- gRPC status codes: https://grpc.io/docs/guides/status-codes/
- gRPC metadata: https://grpc.io/docs/guides/metadata/
- gRPC retry: https://grpc.io/docs/guides/retry/
- gRPC flow control: https://grpc.io/docs/guides/flow-control/
- gRPC keepalive: https://grpc.io/docs/guides/keepalive/
- gRPC health checking: https://grpc.io/docs/guides/health-checking/
- Protocol Buffers style guide: https://protobuf.dev/programming-guides/style/
- Protocol Buffers proto3 guide: https://protobuf.dev/programming-guides/proto3/
