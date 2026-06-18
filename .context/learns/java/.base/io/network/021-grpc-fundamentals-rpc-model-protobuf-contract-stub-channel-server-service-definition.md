# Part 21 — gRPC Fundamentals: RPC Model, Protobuf Contract, Stub, Channel, Server, and Service Definition

> Series: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `021-grpc-fundamentals-rpc-model-protobuf-contract-stub-channel-server-service-definition.md`  
> Scope: Java 8–25, gRPC Java, Protocol Buffers, service contract design, production mental model  
> Position: after HTTP/WebSocket fundamentals, before gRPC transport internals

---

## 1. Why This Part Exists

By this point, we have already built the lower layers:

```text
TCP byte stream
-> protocol framing
-> serialization format
-> HTTP semantics
-> HTTP/1.1 connection behavior
-> HTTP/2 stream/frame model
-> timeout/retry/resource engineering
-> proxy/LB/service mesh behavior
-> REST contract design
-> long-lived HTTP and WebSocket behavior
```

Now we enter gRPC.

A shallow engineer sees gRPC as:

```text
"REST but faster"
"HTTP/2 + Protobuf"
"generated client/server code"
"microservice RPC framework"
```

Those are partially true, but incomplete.

A strong engineer sees gRPC as:

```text
A typed remote procedure call system
where the service contract is declared in .proto,
compiled into client/server bindings,
executed over HTTP/2 streams,
serialized with Protocol Buffers,
and governed by explicit rules for deadline, cancellation, status, metadata,
flow control, compatibility, and channel lifecycle.
```

The top-tier mental model is this:

```text
A gRPC call looks like a local method call,
but it is never a local method call.

It is a distributed attempt with:
- network latency,
- remote ownership,
- partial failure,
- cancellation ambiguity,
- deadline pressure,
- version skew,
- load balancing behavior,
- transport state,
- and semantic side effects.
```

This part focuses on the fundamentals: what gRPC is, how the Java pieces fit together, and how to design gRPC contracts without creating fragile distributed systems.

---

## 2. What This Part Will Not Repeat

We will not repeat:

- basic TCP concepts,
- basic HTTP/2 frame theory,
- basic Protobuf scalar syntax in exhaustive detail,
- generic microservice introduction,
- Java build tool basics,
- Servlet/JAX-RS REST patterns,
- JSON vs Protobuf comparison already covered earlier.

Instead, this part focuses on:

- gRPC mental model,
- RPC design trade-offs,
- `.proto` as service contract,
- Java generated code,
- stubs,
- channel,
- server,
- method shapes,
- error/status model,
- deadline/cancellation basics,
- compatibility rules,
- production-oriented service design.

---

## 3. gRPC in One Accurate Picture

At a high level:

```text
.proto file
  defines messages and services
        |
        v
protoc + grpc plugin
  generates Java message classes and service/stub classes
        |
        +-------------------------------+
        |                               |
        v                               v
server implementation              client stub
extends generated base              calls generated methods
        |                               |
        v                               v
gRPC Server                     ManagedChannel
        |                               |
        +--------------- HTTP/2 --------+
                        |
                        v
                 remote call execution
```

Important distinction:

```text
Protobuf defines message schema.
gRPC defines service method invocation over a transport.
HTTP/2 provides multiplexed stream transport.
Java generated code provides type-safe bindings.
```

Do not collapse these into one concept.

If something fails, ask:

```text
Did the failure happen at schema level?
At generated-code integration level?
At client stub usage level?
At channel/transport level?
At HTTP/2 stream level?
At server handler level?
At domain operation level?
At deadline/cancellation level?
At load balancer/name resolver level?
```

That separation is the foundation for debugging gRPC systems.

---

## 4. RPC Model: Local Shape, Remote Reality

A gRPC method often looks like this from Java:

```java
UserResponse response = userServiceBlockingStub.getUser(
    UserRequest.newBuilder()
        .setUserId("u-123")
        .build()
);
```

This looks like:

```text
call method
get return value
catch exception
```

But the actual system is closer to:

```text
construct request message
serialize to Protobuf bytes
attach metadata
choose channel/subchannel/connection
open HTTP/2 stream
send request headers
send message frame(s)
half-close request stream
server receives metadata
server deserializes request
server executes handler
server serializes response
server sends response message
server sends trailers with status
client receives response/trailers
client maps status to response or exception
```

The danger of RPC is psychological: it hides the network.

The benefit of RPC is also psychological: it gives a clean typed contract.

A top-tier engineer uses gRPC while resisting the illusion that the remote call is local.

---

## 5. gRPC vs REST: The Real Difference

Do not reduce the comparison to performance.

A better comparison:

| Dimension | REST over HTTP | gRPC |
|---|---|---|
| Contract style | Resource/representation oriented | Service/method oriented |
| Schema | Often OpenAPI/JSON Schema, sometimes informal | `.proto` strongly central |
| Encoding | Commonly JSON | Protobuf by default |
| Transport | HTTP/1.1 or HTTP/2 commonly | HTTP/2 fundamentally |
| Browser friendliness | Excellent | Limited without gRPC-Web/proxy |
| Human debuggability | High with curl/browser | Lower without tooling |
| Streaming | Possible but varied | First-class unary/streaming method types |
| Error model | HTTP status + body | gRPC status + trailers + details |
| Evolution | Often resource/version driven | Field-number/schema compatibility driven |
| Gateway compatibility | Very high | Depends on proxy/LB HTTP/2 support |
| Best fit | Public APIs, CRUD-ish resources, web-friendly APIs | Internal service calls, typed service mesh, streaming, polyglot RPC |

REST asks:

```text
What resource is being manipulated?
What representation is transferred?
What HTTP semantics apply?
```

gRPC asks:

```text
What operation is being invoked?
What typed request/response messages define it?
What deadline, status, metadata, and stream semantics apply?
```

Neither is universally superior.

For internal service-to-service systems, gRPC often wins when:

- typed contracts matter,
- payload efficiency matters,
- low-latency internal calls matter,
- streaming matters,
- client/server code generation is beneficial,
- multiple languages must interoperate,
- API consumers are controlled.

REST often remains better when:

- public HTTP API compatibility matters,
- browser/client ecosystem matters,
- cache/CDN behavior matters,
- human inspection/debuggability matters,
- generic tooling matters,
- resource semantics are central.

---

## 6. The Four gRPC Method Shapes

gRPC has four method shapes.

### 6.1 Unary RPC

```protobuf
rpc GetUser(GetUserRequest) returns (GetUserResponse);
```

Shape:

```text
one request -> one response
```

Use for:

- lookup,
- validation,
- command execution,
- small query,
- synchronous workflow step.

Java mental model:

```java
GetUserResponse response = stub.getUser(request);
```

Risks:

- pretending it is a local call,
- missing deadline,
- retrying non-idempotent commands,
- returning huge response payloads,
- using generic `string payload_json` instead of typed fields.

---

### 6.2 Server Streaming RPC

```protobuf
rpc ListCaseEvents(ListCaseEventsRequest) returns (stream CaseEvent);
```

Shape:

```text
one request -> many responses
```

Use for:

- event listing,
- feed stream,
- progressive report generation,
- large result delivery,
- subscription-like read path.

Risks:

- slow client causing server memory pressure,
- no resume cursor,
- no maximum stream duration,
- mixing snapshot and live events without clear semantics,
- not handling cancellation.

Better design:

```protobuf
message ListCaseEventsRequest {
  string case_id = 1;
  string after_event_id = 2;
  int32 max_events = 3;
}

message CaseEvent {
  string event_id = 1;
  string case_id = 2;
  string type = 3;
  int64 occurred_at_epoch_millis = 4;
  bytes payload = 5;
}

service CaseEventService {
  rpc ListCaseEvents(ListCaseEventsRequest) returns (stream CaseEvent);
}
```

Key invariant:

```text
Streaming is not an excuse to avoid pagination/cursor design.
```

---

### 6.3 Client Streaming RPC

```protobuf
rpc UploadEvidence(stream EvidenceChunk) returns (UploadEvidenceResult);
```

Shape:

```text
many requests -> one response
```

Use for:

- upload,
- ingestion,
- batching,
- progressive data submission.

Risks:

- no chunk ordering,
- no checksum,
- no max size,
- no resumability,
- server accumulates everything in memory,
- final response cannot describe partial acceptance clearly.

Better mental model:

```text
client streaming is a protocol inside a protocol.
```

A robust upload stream needs:

```text
upload_id
chunk_index
chunk_size
content_hash/checksum
total_size or unknown-size semantics
metadata frame/message
completion marker
server-side max size
cancellation semantics
idempotency/resume design
```

---

### 6.4 Bidirectional Streaming RPC

```protobuf
rpc Chat(stream ClientMessage) returns (stream ServerMessage);
```

Shape:

```text
many requests <-> many responses
```

Use for:

- interactive sessions,
- live collaboration,
- event bridge,
- command/ack protocol,
- low-latency state sync,
- long-lived agent communication.

Risks:

- unclear ordering,
- unclear correlation,
- unbounded queues,
- flow-control bugs,
- hard-to-replay incidents,
- half-open session confusion,
- poor shutdown behavior.

A bidirectional stream almost always needs an envelope:

```protobuf
message ClientEnvelope {
  string message_id = 1;
  string correlation_id = 2;
  int64 sequence = 3;
  oneof payload {
    ClientHello hello = 10;
    ClientCommand command = 11;
    ClientAck ack = 12;
    ClientHeartbeat heartbeat = 13;
  }
}

message ServerEnvelope {
  string message_id = 1;
  string correlation_id = 2;
  int64 sequence = 3;
  oneof payload {
    ServerHello hello = 10;
    CommandAccepted accepted = 11;
    CommandRejected rejected = 12;
    ServerEvent event = 13;
    ServerHeartbeat heartbeat = 14;
  }
}
```

Without an envelope, bidi streaming often degenerates into an undocumented custom protocol.

---

## 7. `.proto` as Contract, Not Serialization Detail

A `.proto` file is not merely a serializer configuration.

It is an IDL: Interface Definition Language.

It defines:

```text
package namespace
message schema
field numbers
field types
service methods
request/response contracts
streaming shapes
comments/documentation
language generation options
compatibility surface
```

Example:

```protobuf
syntax = "proto3";

package enforcement.case.v1;

option java_multiple_files = true;
option java_package = "com.example.enforcement.caseapi.v1";
option java_outer_classname = "CaseServiceProto";

service CaseService {
  rpc GetCase(GetCaseRequest) returns (GetCaseResponse);
  rpc SubmitCaseDecision(SubmitCaseDecisionRequest) returns (SubmitCaseDecisionResponse);
  rpc ListCaseEvents(ListCaseEventsRequest) returns (stream CaseEvent);
}

message GetCaseRequest {
  string case_id = 1;
}

message GetCaseResponse {
  CaseView case = 1;
}

message SubmitCaseDecisionRequest {
  string case_id = 1;
  string decision_id = 2;
  string idempotency_key = 3;
  DecisionType decision_type = 4;
  string reason = 5;
}

message SubmitCaseDecisionResponse {
  string decision_id = 1;
  DecisionStatus status = 2;
}

message CaseView {
  string case_id = 1;
  string status = 2;
  int64 created_at_epoch_millis = 3;
  int64 updated_at_epoch_millis = 4;
}

message ListCaseEventsRequest {
  string case_id = 1;
  string after_event_id = 2;
  int32 max_events = 3;
}

message CaseEvent {
  string event_id = 1;
  string case_id = 2;
  string type = 3;
  int64 occurred_at_epoch_millis = 4;
  bytes payload = 5;
}

enum DecisionType {
  DECISION_TYPE_UNSPECIFIED = 0;
  DECISION_TYPE_APPROVE = 1;
  DECISION_TYPE_REJECT = 2;
  DECISION_TYPE_ESCALATE = 3;
}

enum DecisionStatus {
  DECISION_STATUS_UNSPECIFIED = 0;
  DECISION_STATUS_ACCEPTED = 1;
  DECISION_STATUS_DUPLICATE = 2;
  DECISION_STATUS_REJECTED = 3;
}
```

Notice the contract decisions:

- package includes version-like namespace `v1`,
- Java package is explicit,
- method names are operation-oriented,
- command request has `idempotency_key`,
- timestamps are represented explicitly,
- enums have `UNSPECIFIED = 0`,
- streaming list has cursor and max limit.

These are not cosmetic. They define operational safety.

---

## 8. Message Design Principles

### 8.1 Field Numbers Are Forever

In Protobuf, field numbers are the stable wire identity.

This means:

```protobuf
message User {
  string id = 1;
  string name = 2;
}
```

The wire does not care about the Java field name the same way JSON does. The numeric tag matters.

Never casually reuse field numbers.

Bad evolution:

```protobuf
message User {
  string id = 1;
  // old: string name = 2;
  int64 birth_date = 2; // BAD: reused field number
}
```

Safer:

```protobuf
message User {
  string id = 1;
  string name = 2 [deprecated = true];
  int64 birth_date_epoch_day = 3;

  reserved 4, 5;
  reserved "old_status";
}
```

Mental invariant:

```text
Field numbers are part of your public binary ABI.
```

---

### 8.2 Avoid Ambiguous Presence

Proto3 historically made scalar presence tricky. Modern proto3 supports `optional`, but teams must use it intentionally.

Ambiguous:

```protobuf
message UpdateProfileRequest {
  string display_name = 1;
}
```

Does empty string mean:

```text
not provided?
clear the value?
set to empty?
invalid?
```

Better:

```protobuf
message UpdateProfileRequest {
  optional string display_name = 1;
}
```

Or for patch semantics:

```protobuf
import "google/protobuf/field_mask.proto";

message UpdateProfileRequest {
  string user_id = 1;
  ProfilePatch patch = 2;
  google.protobuf.FieldMask update_mask = 3;
}
```

Top-tier rule:

```text
Do not design update APIs until you can explain absence, null-equivalent, default, clear, and unchanged semantics.
```

---

### 8.3 Use Enums Carefully

Always include zero value:

```protobuf
enum CaseStatus {
  CASE_STATUS_UNSPECIFIED = 0;
  CASE_STATUS_DRAFT = 1;
  CASE_STATUS_SUBMITTED = 2;
  CASE_STATUS_APPROVED = 3;
  CASE_STATUS_REJECTED = 4;
}
```

Why?

Proto3 default enum value is zero. If zero means a real domain state, missing data may be interpreted as valid.

Bad:

```protobuf
enum CaseStatus {
  DRAFT = 0;
  SUBMITTED = 1;
}
```

This makes missing status indistinguishable from draft.

Better:

```text
0 = unspecified / unknown / invalid default
real values start from 1
```

---

### 8.4 Avoid Leaking Internal Domain Model Directly

Bad:

```protobuf
message CaseEntity {
  string id = 1;
  string jpa_version = 2;
  string internal_workflow_state = 3;
  string created_by_user_table_fk = 4;
  string serialized_blob = 5;
}
```

This leaks persistence and implementation.

Better:

```protobuf
message CaseView {
  string case_id = 1;
  CaseStatus status = 2;
  string assigned_team_id = 3;
  int64 submitted_at_epoch_millis = 4;
  int64 version = 5;
}
```

A gRPC contract is not your database schema.

---

### 8.5 Avoid Generic `map<string, string>` as Escape Hatch

Bad:

```protobuf
message SubmitRequest {
  map<string, string> attributes = 1;
}
```

This loses:

- type safety,
- compatibility guarantees,
- documentation,
- validation clarity,
- generated-code usefulness,
- observability discipline.

Use generic maps only for genuinely open-ended metadata.

Better:

```protobuf
message SubmitRequest {
  string case_id = 1;
  Applicant applicant = 2;
  repeated SupportingDocument documents = 3;
  map<string, string> client_metadata = 100;
}
```

Reserve high field numbers for extension-like optional metadata if needed.

---

## 9. Generated Java Code: What You Actually Get

From `.proto`, the build generates Java classes.

For messages, you get classes roughly like:

```java
GetCaseRequest request = GetCaseRequest.newBuilder()
    .setCaseId("CASE-123")
    .build();

String caseId = request.getCaseId();
```

Characteristics:

```text
immutable message instances
builder-based construction
getters for fields
serialization/deserialization methods
unknown field handling
nested types depending on options
```

For services, gRPC Java generates:

```text
CaseServiceGrpc
CaseServiceGrpc.CaseServiceImplBase
CaseServiceGrpc.CaseServiceBlockingStub
CaseServiceGrpc.CaseServiceFutureStub
CaseServiceGrpc.CaseServiceStub
```

Typical server implementation:

```java
public final class CaseServiceImpl extends CaseServiceGrpc.CaseServiceImplBase {

    @Override
    public void getCase(
            GetCaseRequest request,
            StreamObserver<GetCaseResponse> responseObserver
    ) {
        try {
            GetCaseResponse response = GetCaseResponse.newBuilder()
                .setCase(loadCase(request.getCaseId()))
                .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (CaseNotFoundException e) {
            responseObserver.onError(
                Status.NOT_FOUND
                    .withDescription("Case not found")
                    .asRuntimeException()
            );
        } catch (Exception e) {
            responseObserver.onError(
                Status.INTERNAL
                    .withDescription("Internal server error")
                    .asRuntimeException()
            );
        }
    }
}
```

Typical client:

```java
ManagedChannel channel = ManagedChannelBuilder
    .forAddress("case-service.internal", 443)
    .useTransportSecurity()
    .build();

CaseServiceGrpc.CaseServiceBlockingStub stub = CaseServiceGrpc.newBlockingStub(channel);

GetCaseResponse response = stub
    .withDeadlineAfter(500, TimeUnit.MILLISECONDS)
    .getCase(GetCaseRequest.newBuilder()
        .setCaseId("CASE-123")
        .build());
```

Production warning:

```text
Do not create a ManagedChannel per request.
Do not omit deadlines.
Do not convert all StatusRuntimeException into generic RuntimeException.
Do not expose generated messages directly as your domain model everywhere.
```

---

## 10. Stub Types in Java

gRPC Java commonly provides three styles.

### 10.1 Blocking Stub

```java
CaseServiceGrpc.CaseServiceBlockingStub stub = CaseServiceGrpc.newBlockingStub(channel);
GetCaseResponse response = stub.getCase(request);
```

Good for:

- simple synchronous server-side code,
- admin jobs,
- virtual-thread based clients,
- request/response workflows.

Risks:

- thread blocking,
- missing deadline,
- too many concurrent calls,
- hard cancellation if wrapped poorly.

With virtual threads, blocking stubs become more attractive, but not magic. The remote system, channel, connection pool, stream limit, and CPU are still finite.

---

### 10.2 Future Stub

```java
CaseServiceGrpc.CaseServiceFutureStub futureStub = CaseServiceGrpc.newFutureStub(channel);
ListenableFuture<GetCaseResponse> future = futureStub.getCase(request);
```

Good for:

- integration with future-based async flows,
- parallel request fan-out,
- non-blocking composition.

Risks:

- forgotten cancellation,
- unmanaged executor/callback behavior,
- fan-out without budget,
- poor error mapping.

---

### 10.3 Async Stub

```java
CaseServiceGrpc.CaseServiceStub asyncStub = CaseServiceGrpc.newStub(channel);
asyncStub.getCase(request, new StreamObserver<GetCaseResponse>() {
    @Override
    public void onNext(GetCaseResponse value) {
        // consume response
    }

    @Override
    public void onError(Throwable t) {
        // handle failure
    }

    @Override
    public void onCompleted() {
        // done
    }
});
```

Required for:

- client streaming,
- server streaming consumption,
- bidirectional streaming,
- callback-based non-blocking interaction.

Risks:

- broken observer lifecycle,
- concurrent access to non-thread-safe observer,
- unbounded buffering,
- hard-to-follow control flow,
- cancellation not propagated.

---

## 11. Channel: More Than a Connection

A `ManagedChannel` is not simply one socket.

It is a client-side abstraction that may involve:

```text
target name
name resolver
load balancer policy
subchannels
HTTP/2 connections
connection state
TLS configuration
keepalive settings
executor/event loop resources
idle/ready/transient failure states
```

The official gRPC model treats channel as the object used to create stubs and connect to a server target. In Java, `ManagedChannel` also has lifecycle methods such as shutdown and termination.

Mental model:

```text
Stub is cheap.
Channel is expensive and stateful.
Transport connection is below channel.
```

Bad:

```java
public GetCaseResponse call(GetCaseRequest request) {
    ManagedChannel channel = ManagedChannelBuilder.forAddress(host, port).build();
    try {
        return CaseServiceGrpc.newBlockingStub(channel).getCase(request);
    } finally {
        channel.shutdownNow();
    }
}
```

This causes:

- connection churn,
- TLS handshake overhead,
- poor load balancing,
- resource leak risk,
- latency spike,
- ephemeral port pressure.

Better:

```java
public final class CaseGrpcClient implements AutoCloseable {
    private final ManagedChannel channel;
    private final CaseServiceGrpc.CaseServiceBlockingStub blockingStub;

    public CaseGrpcClient(String host, int port) {
        this.channel = ManagedChannelBuilder
            .forAddress(host, port)
            .useTransportSecurity()
            .build();

        this.blockingStub = CaseServiceGrpc.newBlockingStub(channel);
    }

    public GetCaseResponse getCase(String caseId, Duration deadline) {
        return blockingStub
            .withDeadlineAfter(deadline.toMillis(), TimeUnit.MILLISECONDS)
            .getCase(GetCaseRequest.newBuilder()
                .setCaseId(caseId)
                .build());
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

Top-tier invariant:

```text
A channel is a managed transport subsystem. Own it explicitly.
```

---

## 12. Server: Handler Runtime, Not Just Generated Base Class

A gRPC server includes:

```text
listening address/port
transport implementation
registered service implementations
interceptors
executor/event loop
TLS/mTLS configuration
max message size
flow control settings
keepalive policy
reflection/health services
shutdown lifecycle
```

Minimal server:

```java
Server server = ServerBuilder
    .forPort(8443)
    .addService(new CaseServiceImpl())
    .build()
    .start();

Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    server.shutdown();
}));

server.awaitTermination();
```

Production concerns:

```text
Which executor runs business logic?
What is the max inbound message size?
How are deadlines checked?
How are cancellations handled?
How is metadata authenticated?
How are errors mapped?
How are interceptors ordered?
How is graceful shutdown implemented?
How are health/reflection exposed?
How does it behave behind load balancer/service mesh?
```

Server implementation must not blindly execute long work after the client has cancelled.

For long-running handlers:

```java
Context context = Context.current();
if (context.isCancelled()) {
    return;
}
```

Or check cancellation at safe points.

---

## 13. Metadata: Headers for gRPC, But Not Business Payload

gRPC metadata is key-value data attached to calls.

Use metadata for:

- authentication token,
- correlation id,
- trace context,
- tenant id,
- locale,
- caller identity claim,
- feature flag context,
- request classification.

Do not use metadata for:

- large payload,
- domain object fields,
- business command data,
- frequently queried state,
- unbounded strings.

Bad:

```text
metadata["case-json"] = huge JSON string
```

Better:

```protobuf
message SubmitCaseDecisionRequest {
  string case_id = 1;
  string decision_id = 2;
  string idempotency_key = 3;
  DecisionType decision_type = 4;
  string reason = 5;
}
```

Metadata should be small, bounded, and infrastructure-oriented.

---

## 14. Status Model: gRPC Errors Are Not Java Exceptions Only

gRPC has canonical status codes such as:

```text
OK
CANCELLED
UNKNOWN
INVALID_ARGUMENT
DEADLINE_EXCEEDED
NOT_FOUND
ALREADY_EXISTS
PERMISSION_DENIED
RESOURCE_EXHAUSTED
FAILED_PRECONDITION
ABORTED
OUT_OF_RANGE
UNIMPLEMENTED
INTERNAL
UNAVAILABLE
DATA_LOSS
UNAUTHENTICATED
```

Client-side Java often sees failures as `StatusRuntimeException` or `StatusException`.

Example:

```java
try {
    return stub.getCase(request);
} catch (StatusRuntimeException e) {
    Status.Code code = e.getStatus().getCode();
    switch (code) {
        case NOT_FOUND:
            throw new CaseNotFoundClientException(request.getCaseId(), e);
        case DEADLINE_EXCEEDED:
            throw new DependencyTimeoutException("case-service", e);
        case UNAVAILABLE:
            throw new DependencyUnavailableException("case-service", e);
        default:
            throw new GrpcDependencyException("case-service", code, e);
    }
}
```

Important mapping discipline:

| Situation | Better gRPC status |
|---|---|
| syntactically invalid request | `INVALID_ARGUMENT` |
| caller not authenticated | `UNAUTHENTICATED` |
| caller authenticated but not allowed | `PERMISSION_DENIED` |
| entity not found | `NOT_FOUND` |
| duplicate create | `ALREADY_EXISTS` |
| business state does not allow action | `FAILED_PRECONDITION` |
| optimistic concurrency conflict | `ABORTED` |
| rate/concurrency limit hit | `RESOURCE_EXHAUSTED` |
| dependency temporarily unavailable | `UNAVAILABLE` |
| server bug/unexpected exception | `INTERNAL` |
| client deadline expired | `DEADLINE_EXCEEDED` |
| client cancelled | `CANCELLED` |

Do not map everything to `UNKNOWN` or `INTERNAL`.

---

## 15. Deadlines: Required, Not Optional

A gRPC deadline tells the system how long the client is willing to wait.

Bad:

```java
stub.getCase(request); // no deadline
```

Better:

```java
stub.withDeadlineAfter(500, TimeUnit.MILLISECONDS)
    .getCase(request);
```

Why deadlines matter:

```text
They bound resource usage.
They help servers stop useless work.
They make retry budgets calculable.
They prevent infinite hanging calls.
They provide clear failure semantics.
```

Design principle:

```text
Every outbound gRPC call must have a deadline derived from the caller's remaining budget.
```

Do not set deadlines randomly per method. Build a budget model:

```text
incoming request budget: 2000ms
validation: 100ms
case-service: 500ms
document-service: 700ms
notification-service: 300ms
finalization margin: 200ms
```

In a workflow:

```text
Do not give every downstream call 2 seconds.
Propagate remaining time.
```

---

## 16. Cancellation: Success, Failure, or Unknown?

Cancellation is not the same as rollback.

If client cancels:

```text
server may not have received request
server may have received request but not started
server may be executing
server may have committed side effect
server may have responded but response was not received
```

Therefore:

```text
Cancellation does not imply no effect.
Deadline exceeded does not imply no effect.
UNAVAILABLE after write does not imply no effect.
```

For non-idempotent commands, design an idempotency key:

```protobuf
message SubmitCaseDecisionRequest {
  string case_id = 1;
  string decision_id = 2;
  string idempotency_key = 3;
  DecisionType decision_type = 4;
}
```

Then server can safely respond:

```text
first attempt: accepted and committed
retry after timeout: duplicate recognized, same logical result returned
```

---

## 17. Service Design: Avoid Distributed Object Thinking

Bad service design:

```protobuf
service CaseObjectService {
  rpc SetStatus(SetStatusRequest) returns (Empty);
  rpc SetAssignee(SetAssigneeRequest) returns (Empty);
  rpc SetPriority(SetPriorityRequest) returns (Empty);
  rpc Save(SaveRequest) returns (Empty);
}
```

This treats remote service like a mutable object.

Problems:

- too chatty,
- no transaction boundary,
- partial updates are ambiguous,
- audit semantics weak,
- authorization scattered,
- retries dangerous,
- state machine invariants leak to client.

Better service design:

```protobuf
service CaseCommandService {
  rpc SubmitApplication(SubmitApplicationRequest) returns (SubmitApplicationResponse);
  rpc AssignCase(AssignCaseRequest) returns (AssignCaseResponse);
  rpc EscalateCase(EscalateCaseRequest) returns (EscalateCaseResponse);
  rpc SubmitDecision(SubmitDecisionRequest) returns (SubmitDecisionResponse);
}
```

This is operation-oriented and maps to business invariants.

Rule:

```text
Remote calls should represent meaningful business operations, not tiny object mutations.
```

---

## 18. Granularity: The Cost of Chatty RPC

Because gRPC is efficient, teams often overuse small calls.

Bad:

```text
GetCaseBasicInfo(caseId)
GetCaseApplicant(caseId)
GetCaseDocuments(caseId)
GetCaseAssignments(caseId)
GetCaseLatestDecision(caseId)
GetCaseRiskFlags(caseId)
```

If the UI or caller always needs all of these together, this creates:

- network fan-out,
- deadline fragmentation,
- failure multiplication,
- observability noise,
- inconsistent snapshot risk,
- latency dominated by p99 of many calls.

Better:

```protobuf
rpc GetCaseWorkspace(GetCaseWorkspaceRequest) returns (GetCaseWorkspaceResponse);
```

With explicit field selection if needed:

```protobuf
message GetCaseWorkspaceRequest {
  string case_id = 1;
  repeated CaseWorkspaceSection sections = 2;
}
```

Granularity rule:

```text
Design RPC boundaries around stable use cases and consistency boundaries,
not around database tables or Java entity classes.
```

---

## 19. Versioning and Compatibility

gRPC/Protobuf compatibility depends on schema evolution discipline.

Generally safe:

```text
add new optional field with new field number
add new enum value if clients tolerate unknowns
add new RPC method
add new message type
stop using but keep old field number reserved/deprecated
```

Dangerous:

```text
change field number
reuse deleted field number
change field type incompatibly
rename package without migration
remove RPC method still used by clients
change semantic meaning of existing field
make previously optional concept required semantically
change enum zero value meaning
```

Example safe evolution:

```protobuf
message GetCaseResponse {
  CaseView case = 1;
  repeated Warning warnings = 2; // added later
}
```

Example unsafe evolution:

```protobuf
message GetCaseResponse {
  string case = 1; // old field was CaseView case = 1; BAD
}
```

Top-tier compatibility thinking:

```text
Wire compatibility is necessary but not sufficient.
Semantic compatibility matters more.
```

A new field can still break clients if:

- server changes default behavior,
- enum interpretation changes,
- ordering changes,
- old clients are no longer authorized,
- server starts returning much larger payloads,
- error code changes unexpectedly.

---

## 20. Package and Namespace Strategy

Bad:

```protobuf
package service;
```

Better:

```protobuf
package enforcement.case.v1;

option java_package = "com.company.enforcement.caseapi.v1";
option java_multiple_files = true;
```

Why:

```text
prevents generated-code collision
makes version explicit
supports multiple APIs side-by-side
keeps Java package stable
separates protobuf package from Java package
```

Suggested naming pattern:

```text
<domain>.<subdomain>.<api-name>.v<major>
```

Examples:

```text
enforcement.case.v1
enforcement.document.v1
enforcement.identity.v1
enforcement.notification.v1
```

Do not put deployment environment in package:

```text
bad: enforcement.case.uat.v1
bad: enforcement.case.prod.v1
```

Environment is deployment configuration, not API identity.

---

## 21. Empty Messages and Well-Known Types

Sometimes a method takes or returns no data.

Use:

```protobuf
import "google/protobuf/empty.proto";

rpc Ping(google.protobuf.Empty) returns (google.protobuf.Empty);
```

Common well-known types:

```text
google.protobuf.Empty
google.protobuf.Timestamp
google.protobuf.Duration
google.protobuf.FieldMask
google.protobuf.Struct
google.protobuf.Any
```

Be careful with `Any` and `Struct`.

They are flexible, but flexibility weakens the contract.

Use `Any` only when:

- plugin/extensibility is truly required,
- type URL/versioning is governed,
- consumers know how to unpack safely,
- validation and security are clear.

Do not use `Struct` to recreate JSON APIs inside gRPC unless you deliberately want weak typing.

---

## 22. Build Integration Mental Model

A typical Java build needs:

```text
protobuf compiler
protobuf Java runtime
gRPC Java plugin
protobuf Gradle/Maven plugin
generated sources attached to compile path
grpc-api/grpc-stub/grpc-protobuf/grpc-netty or grpc-netty-shaded
```

Conceptual Gradle shape:

```gradle
plugins {
    id "java"
    id "com.google.protobuf" version "..."
}

dependencies {
    implementation "io.grpc:grpc-netty-shaded:..."
    implementation "io.grpc:grpc-protobuf:..."
    implementation "io.grpc:grpc-stub:..."
    implementation "com.google.protobuf:protobuf-java:..."
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:..."
    }
    plugins {
        grpc {
            artifact = "io.grpc:protoc-gen-grpc-java:..."
        }
    }
    generateProtoTasks {
        all()*.plugins {
            grpc {}
        }
    }
}
```

This part is not about exact dependency versions. The production rule is:

```text
Pin versions deliberately.
Align grpc/protobuf plugin/runtime versions.
Generate code reproducibly in CI.
Avoid committing generated code unless your repository policy requires it.
Validate backward compatibility in CI.
```

---

## 23. Interceptors: Cross-Cutting Behavior

Client interceptor use cases:

- add auth token,
- add correlation id,
- add trace context,
- record metrics,
- log request metadata,
- enforce default deadline,
- map errors,
- add tenant context.

Server interceptor use cases:

- authentication,
- authorization precheck,
- trace extraction,
- metrics,
- audit context setup,
- request validation shell,
- rate limiting,
- exception mapping.

Do not put business logic inside interceptors unless it is truly cross-cutting.

Bad:

```text
Interceptor decides whether a case can be approved based on workflow state.
```

Better:

```text
Interceptor authenticates caller and extracts identity.
Service handler enforces domain authorization and workflow invariant.
```

Interceptors are powerful because they are invisible to method signatures. That also makes them dangerous.

---

## 24. Health Checking and Reflection

Production gRPC systems often expose:

```text
gRPC health checking service
gRPC reflection service
```

Health checking helps load balancers or orchestrators know whether a service is serving.

Reflection helps tools inspect service definitions dynamically.

But reflection should be controlled:

```text
safe in internal dev/test
possibly restricted in production
review security implications
avoid exposing sensitive internal API shape unintentionally
```

Health should distinguish:

```text
process alive
transport accepting
service ready
dependency ready
traffic should be routed
```

Do not make health check depend on every downstream dependency unless you want dependency blips to eject all pods.

---

## 25. Security Basics in gRPC

Security layers:

```text
transport security: TLS/mTLS
authentication: who is caller?
authorization: can caller perform operation?
metadata validation: are headers trusted?
message validation: is request semantically valid?
resource protection: size/rate/deadline/concurrency limit
error hygiene: avoid leaking internals
```

Common mistakes:

- using plaintext in production,
- trusting caller-supplied identity metadata without mTLS/gateway validation,
- no max inbound message size,
- no deadline,
- no auth in streaming after connection established,
- leaking stack traces in status description,
- treating internal network as fully trusted,
- allowing reflection publicly.

Security invariant:

```text
gRPC being internal does not make it safe.
```

---

## 26. Example: A Production-Oriented gRPC Client Wrapper

```java
public final class CaseServiceClient implements AutoCloseable {

    private final ManagedChannel channel;
    private final CaseServiceGrpc.CaseServiceBlockingStub baseStub;

    public CaseServiceClient(String target) {
        this.channel = ManagedChannelBuilder
            .forTarget(target)
            .useTransportSecurity()
            .build();

        this.baseStub = CaseServiceGrpc.newBlockingStub(channel);
    }

    public CaseView getCase(String caseId, Duration timeout) {
        GetCaseRequest request = GetCaseRequest.newBuilder()
            .setCaseId(caseId)
            .build();

        try {
            return baseStub
                .withDeadlineAfter(timeout.toMillis(), TimeUnit.MILLISECONDS)
                .getCase(request)
                .getCase();
        } catch (StatusRuntimeException e) {
            throw mapException("GetCase", caseId, e);
        }
    }

    public SubmitCaseDecisionResponse submitDecision(
            String caseId,
            String decisionId,
            String idempotencyKey,
            DecisionType decisionType,
            String reason,
            Duration timeout
    ) {
        SubmitCaseDecisionRequest request = SubmitCaseDecisionRequest.newBuilder()
            .setCaseId(caseId)
            .setDecisionId(decisionId)
            .setIdempotencyKey(idempotencyKey)
            .setDecisionType(decisionType)
            .setReason(reason)
            .build();

        try {
            return baseStub
                .withDeadlineAfter(timeout.toMillis(), TimeUnit.MILLISECONDS)
                .submitCaseDecision(request);
        } catch (StatusRuntimeException e) {
            throw mapException("SubmitCaseDecision", caseId, e);
        }
    }

    private RuntimeException mapException(String operation, String caseId, StatusRuntimeException e) {
        Status.Code code = e.getStatus().getCode();
        switch (code) {
            case NOT_FOUND:
                return new IllegalArgumentException("Case not found: " + caseId, e);
            case DEADLINE_EXCEEDED:
                return new RuntimeException("Deadline exceeded calling case-service operation " + operation, e);
            case UNAVAILABLE:
                return new RuntimeException("case-service unavailable during operation " + operation, e);
            case FAILED_PRECONDITION:
                return new RuntimeException("Case is not in a valid state for operation " + operation, e);
            default:
                return new RuntimeException("gRPC failure calling " + operation + ": " + code, e);
        }
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

This wrapper centralizes:

- channel lifecycle,
- deadline enforcement,
- exception mapping,
- generated stub isolation,
- operation-specific semantics.

In real production, you would also add:

- metrics,
- tracing,
- metadata propagation,
- retry policy for safe operations,
- idempotency handling,
- auth token injection,
- configuration management,
- testing hooks.

---

## 27. Example: Server Handler with Domain Mapping

```java
public final class CaseServiceImpl extends CaseServiceGrpc.CaseServiceImplBase {

    private final CaseApplicationService applicationService;

    public CaseServiceImpl(CaseApplicationService applicationService) {
        this.applicationService = applicationService;
    }

    @Override
    public void submitCaseDecision(
            SubmitCaseDecisionRequest request,
            StreamObserver<SubmitCaseDecisionResponse> responseObserver
    ) {
        try {
            validate(request);

            SubmitDecisionResult result = applicationService.submitDecision(
                request.getCaseId(),
                request.getDecisionId(),
                request.getIdempotencyKey(),
                mapDecisionType(request.getDecisionType()),
                request.getReason()
            );

            SubmitCaseDecisionResponse response = SubmitCaseDecisionResponse.newBuilder()
                .setDecisionId(result.decisionId())
                .setStatus(mapStatus(result.status()))
                .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (InvalidRequestException e) {
            responseObserver.onError(
                Status.INVALID_ARGUMENT
                    .withDescription(e.getMessage())
                    .asRuntimeException()
            );
        } catch (CaseNotFoundException e) {
            responseObserver.onError(
                Status.NOT_FOUND
                    .withDescription("Case not found")
                    .asRuntimeException()
            );
        } catch (InvalidCaseStateException e) {
            responseObserver.onError(
                Status.FAILED_PRECONDITION
                    .withDescription("Case state does not allow decision submission")
                    .asRuntimeException()
            );
        } catch (DuplicateDecisionException e) {
            SubmitCaseDecisionResponse response = SubmitCaseDecisionResponse.newBuilder()
                .setDecisionId(e.existingDecisionId())
                .setStatus(DecisionStatus.DECISION_STATUS_DUPLICATE)
                .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (Exception e) {
            responseObserver.onError(
                Status.INTERNAL
                    .withDescription("Internal server error")
                    .asRuntimeException()
            );
        }
    }

    private void validate(SubmitCaseDecisionRequest request) {
        if (request.getCaseId().isBlank()) {
            throw new InvalidRequestException("case_id is required");
        }
        if (request.getIdempotencyKey().isBlank()) {
            throw new InvalidRequestException("idempotency_key is required");
        }
        if (request.getDecisionType() == DecisionType.DECISION_TYPE_UNSPECIFIED) {
            throw new InvalidRequestException("decision_type is required");
        }
    }
}
```

Notice:

```text
generated request is mapped into application service call
validation is explicit
status codes are intentional
duplicate handling is semantic, not accidental
internal errors are sanitized
```

---

## 28. gRPC and Java 8–25 Evolution

### Java 8

Common model:

```text
blocking stubs on bounded thread pools
future/async stubs for parallelism
Netty transport common
manual context propagation
manual resource management
```

### Java 11+

Java has modern HTTP client support, but this is separate from gRPC Java. gRPC Java still uses its own stack, commonly Netty-based.

### Java 17

Common enterprise baseline. Better JVM performance, TLS defaults, records/sealed classes useful in wrapper/domain layer, but generated Protobuf classes remain their own style.

### Java 21+

Virtual threads make blocking stub usage more attractive for high-concurrency request orchestration.

But:

```text
virtual threads do not increase remote capacity
virtual threads do not remove gRPC channel stream limits
virtual threads do not remove deadline need
virtual threads do not remove backpressure need
virtual threads do not make streaming trivial
```

### Java 25

Structured concurrency and scoped values become relevant to how Java code can organize related outbound calls, cancellation, and context propagation. But gRPC itself still needs deliberate deadline/context integration.

Top-tier Java 21–25 approach:

```text
Use virtual threads to simplify synchronous orchestration where appropriate.
Use gRPC deadlines to bound remote work.
Use structured concurrency to group related calls.
Use explicit concurrency limits to protect dependencies.
Do not confuse cheap waiting with infinite capacity.
```

---

## 29. Observability Fundamentals

Every gRPC service/client should answer:

```text
Who called whom?
Which method?
What deadline?
How long did it take?
What status code?
Was it cancelled?
Was it retried?
What payload size?
Which peer/target/subchannel?
Which trace/correlation id?
Was failure transport, protocol, or domain?
```

Minimum metrics:

```text
grpc.client.calls.total{service,method,status}
grpc.client.duration{service,method,status}
grpc.client.deadline_exceeded.total{service,method}
grpc.client.cancelled.total{service,method}
grpc.client.message.size{service,method,direction}
grpc.server.calls.total{service,method,status}
grpc.server.duration{service,method,status}
grpc.server.active.streams{service,method}
```

Minimum logs:

```text
operation
service/method
status code
deadline/request timeout
correlation id
trace id
caller identity if safe
case/business id if safe
sanitized error class
```

Never log raw Protobuf payload blindly if it may contain PII, secrets, or sensitive case details.

---

## 30. Common Anti-Patterns

### Anti-pattern 1: No Deadline

```java
stub.getCase(request);
```

Failure:

```text
hung call consumes resources indefinitely
thread/virtual-thread accumulation
server keeps working after caller no longer cares
incident diagnosis becomes unclear
```

---

### Anti-pattern 2: Channel Per Request

```text
new ManagedChannel for every call
```

Failure:

```text
connection churn
TLS overhead
ephemeral port pressure
latency spikes
resource leaks
```

---

### Anti-pattern 3: Entity RPC

```text
GetCaseEntity
SaveCaseEntity
UpdateCaseField
```

Failure:

```text
database schema leaks into API
invariants spread across clients
compatibility becomes fragile
```

---

### Anti-pattern 4: Generic Payload in Protobuf

```protobuf
message Request {
  string payload_json = 1;
}
```

Failure:

```text
lost type safety
lost schema compatibility
lost generated-code value
hard validation
weak observability
```

---

### Anti-pattern 5: Status Code Collapse

```text
everything -> INTERNAL
everything -> UNKNOWN
everything -> OK with error field
```

Failure:

```text
clients cannot retry correctly
SRE cannot classify failure
metrics become useless
business errors mix with infra failures
```

---

### Anti-pattern 6: Streaming Without Protocol

```text
bidi stream with arbitrary messages and no envelope
```

Failure:

```text
no correlation
no ordering semantics
no resume
no versioning
no debugging story
```

---

## 31. Decision Matrix: When to Use gRPC

Use gRPC when:

```text
client/server are controlled
strong schema contract is valuable
polyglot internal service calls are needed
low-latency binary communication matters
streaming is first-class
HTTP/2 infrastructure is available
code generation is acceptable
human browser access is not primary
```

Avoid or reconsider gRPC when:

```text
public browser-facing API is primary
consumers need simple curl/browser access
infrastructure cannot support HTTP/2 correctly
organization lacks schema governance
API changes are ad-hoc
team does not observe deadlines/status/metadata properly
service interactions are naturally resource/cache oriented
```

Hybrid pattern:

```text
External API: REST/HTTP JSON
Internal service calls: gRPC
Bridge: gateway/adapter with explicit mapping
```

This is common and reasonable.

---

## 32. Production Readiness Checklist

Before exposing a gRPC service internally, verify:

```text
[ ] Every RPC method has documented semantics.
[ ] Every command RPC has idempotency story.
[ ] Every client call has deadline.
[ ] Channel lifecycle is owned and reused.
[ ] TLS/mTLS/auth strategy is defined.
[ ] Metadata keys are bounded and governed.
[ ] Status code mapping is documented.
[ ] Request validation is explicit.
[ ] Max inbound/outbound message size is configured.
[ ] Streaming methods have cancellation/backpressure strategy.
[ ] Protobuf field numbers are never reused.
[ ] Deprecated fields are reserved/managed.
[ ] Package and Java namespace are stable.
[ ] Health checking is available.
[ ] Reflection policy is decided.
[ ] Metrics/logs/traces include service/method/status/duration.
[ ] Load balancer/proxy path supports HTTP/2 behavior required.
[ ] Tests include failure, timeout, cancellation, and compatibility cases.
```

---

## 33. Exercises

### Exercise 1: Convert REST to gRPC

Take this REST endpoint:

```http
POST /cases/{caseId}/decision
```

Design:

- gRPC service name,
- RPC method name,
- request message,
- response message,
- status code mapping,
- idempotency rule.

Avoid copying HTTP resource semantics blindly.

---

### Exercise 2: Design a Streaming API

Design a gRPC server-streaming API for:

```text
A case worker opens a case detail page and receives live case events.
```

Specify:

- request fields,
- response envelope,
- cursor/resume strategy,
- max stream duration,
- heartbeat behavior,
- cancellation handling,
- authorization recheck strategy.

---

### Exercise 3: Schema Evolution Review

Given:

```protobuf
message Applicant {
  string name = 1;
  string id_number = 2;
  string status = 3;
}
```

A team proposes:

```protobuf
message Applicant {
  string full_name = 1;
  int64 id_number = 2;
  ApplicantStatus status = 3;
}
```

Identify compatibility problems and propose safer migration.

---

### Exercise 4: Failure Mapping

Map these failures to gRPC status codes:

```text
caller token missing
caller authenticated but lacks permission
case does not exist
case exists but cannot be approved from current state
optimistic lock conflict
downstream database unavailable
server validation bug
client deadline exceeded
rate limit exceeded
```

---

## 34. Key Takeaways

1. gRPC is a typed RPC system, not just faster REST.
2. `.proto` is a long-lived service contract.
3. Protobuf field numbers are compatibility-critical.
4. A stub is cheap; a channel is expensive and stateful.
5. Every outbound call needs a deadline.
6. Cancellation does not mean no side effect happened.
7. Method granularity should follow business operation and consistency boundaries.
8. Streaming methods are protocols and need envelopes, flow control, and resume semantics.
9. Status code discipline determines whether clients can behave safely.
10. gRPC makes remote calls look local; strong engineers remember they are distributed attempts.

---

## 35. References

- gRPC Java basics tutorial: service definition, generated code, simple client/server.
- gRPC core concepts: service definition, server implementation, client stubs, channels.
- gRPC Java GitHub documentation: high-level layers — Stub, Channel, Transport.
- gRPC Java Javadocs: `ManagedChannel`, `ManagedChannelBuilder`.
- Protocol Buffers proto3 language guide.
- Protocol Buffers Java generated code guide.

---

## 36. Next Part

Next:

```text
Part 22 — gRPC Transport Internals: HTTP/2, Netty, Flow Control, Keepalive, Deadlines, and Metadata
```

Part 21 introduced the gRPC programming model.

Part 22 will go below the API into the transport machinery: HTTP/2 streams, Netty transport, metadata/trailers, flow control, keepalive, deadlines, cancellation, message size, compression, and how failures actually propagate through the Java runtime.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — WebSocket Revisited as a Network Protocol](./020-websocket-revisited-as-a-network-protocol.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 22 — gRPC Transport Internals: HTTP/2, Netty, Flow Control, Keepalive, Deadlines, and Metadata](./022-grpc-transport-internals-http2-netty-flow-control-keepalive-deadlines-metadata.md)
