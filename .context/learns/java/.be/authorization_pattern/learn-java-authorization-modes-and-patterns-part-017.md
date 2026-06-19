# learn-java-authorization-modes-and-patterns-part-017

# Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: memahami bagaimana authorization berubah bentuk ketika masuk ke REST API, GraphQL, gRPC, WebSocket/SSE, file endpoint, webhook, messaging, dan service-to-service communication.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas authorization pada beberapa level:

- mental model authorization sebagai decision system,
- vocabulary dan invariant,
- primitive Java platform,
- PEP/PDP/PAP/PIP,
- RBAC, ABAC, PBAC, ReBAC, ACL,
- tenancy dan object-level authorization,
- layered Java application,
- Spring Security request/method/domain authorization,
- Jakarta EE/Jakarta Security/Jakarta Authorization.

Part ini membahas pertanyaan yang lebih operasional:

> Ketika aplikasi Java tidak hanya expose REST endpoint, tetapi juga GraphQL, gRPC, WebSocket, SSE, Kafka/RabbitMQ/JMS consumer, scheduled job, webhook, internal API, dan file download, bagaimana authorization harus ditegakkan agar tidak ada jalur bypass?

Masalah besarnya: banyak tim berpikir authorization hanya terjadi di HTTP controller. Padahal production system punya banyak **entry point** dan **execution path**.

Contoh:

```text
User clicks Approve in UI
  -> REST API /cases/{id}/approve
  -> service checks permission
  -> OK

But another path exists:
  -> batch job consumes message CaseApprovalRequested
  -> directly calls CaseService.approve(...)
  -> no equivalent authorization context
  -> unauthorized state transition can happen
```

Atau:

```text
REST endpoint has tenant filter
  GET /api/cases/{id}

But export endpoint does not:
  POST /api/cases/export

Result:
  normal page is safe,
  export leaks data.
```

Dalam sistem enterprise, authorization harus dilihat sebagai **cross-channel invariant**, bukan fitur per endpoint.

---

## 1. Core Mental Model: Protocol Is Not the Security Boundary

REST, GraphQL, gRPC, WebSocket, Kafka, RabbitMQ, JMS, dan batch hanyalah transport/execution model. Security boundary yang sebenarnya adalah:

```text
Subject + Action + Resource + Context + Policy -> Decision
```

Transport hanya menentukan:

1. dari mana subject/context datang,
2. bagaimana resource/action diekstrak,
3. kapan authorization dievaluasi,
4. bagaimana decision denial dikembalikan,
5. bagaimana audit dicatat,
6. apakah eksekusi bersifat synchronous atau asynchronous,
7. apakah decision bisa di-enforce sebelum eksekusi atau setelah resource di-resolve.

Jadi desain authorization harus menjawab pertanyaan berikut untuk setiap protocol:

```text
1. Siapa subject-nya?
2. Apa action-nya?
3. Apa resource type dan resource instance-nya?
4. Apa context-nya?
5. Di mana PEP-nya?
6. PDP mana yang dipakai?
7. Bagaimana deny dikembalikan?
8. Bagaimana audit ditulis?
9. Bagaimana mencegah bypass dari jalur lain?
10. Bagaimana authorization diterapkan pada bulk/filter/streaming?
```

Top 1% engineer tidak bertanya “di controller pakai annotation apa?”, tetapi:

> “Di seluruh execution graph sistem ini, di mana semua state-changing dan data-revealing action dapat terjadi, dan invariant authorization apa yang harus tetap benar di semua jalur itu?”

---

## 2. Universal Authorization Shape Across Protocols

Kita bisa memodelkan semua protocol ke bentuk yang sama.

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            SubjectRef subject,
            Action action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.subject = subject;
        this.action = action;
        this.resource = resource;
        this.context = context;
    }

    public SubjectRef subject() {
        return subject;
    }

    public Action action() {
        return action;
    }

    public ResourceRef resource() {
        return resource;
    }

    public AuthorizationContext context() {
        return context;
    }
}
```

Contoh mapping:

| Protocol | Subject | Action | Resource | Context |
|---|---|---|---|---|
| REST | principal/session/token | HTTP method + route/business action | path ID/body ID/domain object | tenant, IP, channel, request ID |
| GraphQL | principal/token | field/mutation/resolver operation | node/entity/global ID/field | query name, selected fields, tenant |
| gRPC | metadata principal/mTLS peer | method name/domain command | request message ID/entity | service/method, peer, deadline |
| WebSocket | authenticated connection/subscription | subscribe/send/command | topic/channel/entity | session, connection, room, tenant |
| Kafka/Rabbit/JMS | producer identity/user context/message subject | consume/handle/transition | message key/payload entity | topic, partition, event type, trace |
| Batch | service account + initiating actor if any | process/export/recalculate | dataset/job/resource set | schedule, job ID, tenant scope |
| Webhook | remote system identity | callback event handling | external event/resource | signature, replay window, source |

Karena bentuk akhirnya sama, kita harus membangun authorization service yang bisa dipanggil oleh banyak adapter:

```java
public interface AuthorizationService {
    AuthorizationDecision decide(AuthorizationRequest request);

    default void requireAllowed(AuthorizationRequest request) {
        AuthorizationDecision decision = decide(request);
        if (!decision.allowed()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

Dengan begitu, REST controller, GraphQL resolver, gRPC interceptor, Kafka listener, scheduled job, dan file endpoint tidak membuat logic authorization masing-masing secara liar.

---

## 3. REST API Authorization

REST biasanya paling familiar, tetapi juga paling sering menjadi tempat BOLA/IDOR karena resource ID mudah dimanipulasi.

### 3.1 Route-Level Authorization

Route-level authorization menjawab:

```text
Apakah subject boleh mengakses endpoint family ini?
```

Contoh:

```java
http.authorizeHttpRequests(authz -> authz
    .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("case.read")
    .requestMatchers(HttpMethod.POST, "/api/cases/*/approve").hasAuthority("case.approve")
    .anyRequest().authenticated()
);
```

Ini berguna, tetapi belum cukup.

Route-level check tidak menjawab:

```text
Apakah user boleh membaca case ID 123?
Apakah case 123 berada di tenant/agency user?
Apakah case sedang dalam state yang boleh di-approve?
Apakah user adalah maker yang tidak boleh approve submitannya sendiri?
Apakah user sedang acting sebagai delegate yang scope-nya hanya read-only?
```

Route-level authorization adalah **gate awal**, bukan final decision.

### 3.2 Object-Level Authorization

Object-level authorization menjawab:

```text
Apakah subject boleh melakukan action ini pada object instance ini?
```

Contoh:

```java
@GetMapping("/api/cases/{caseId}")
public CaseDto getCase(@PathVariable UUID caseId) {
    CaseRecord caseRecord = caseRepository.findById(caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.requireAllowed(AuthorizationRequestBuilder.current()
            .action("case.read")
            .resource("case", caseRecord.id())
            .resourceAttribute("tenantId", caseRecord.tenantId())
            .resourceAttribute("status", caseRecord.status())
            .build());

    return caseMapper.toDto(caseRecord);
}
```

Namun pattern yang lebih aman biasanya tidak fetch global lalu check. Untuk read operation, repository sebaiknya sudah scoped:

```java
public Optional<CaseRecord> findVisibleCase(UserContext user, UUID caseId) {
    return jdbcTemplate.query("""
            select *
            from cases
            where id = ?
              and tenant_id = ?
              and agency_id in (?)
            """,
            mapper,
            caseId,
            user.tenantId(),
            user.allowedAgencyIds());
}
```

Lalu service tetap bisa melakukan domain check tambahan.

```java
public CaseDto getCase(UUID caseId) {
    UserContext user = userContextProvider.current();

    CaseRecord caseRecord = caseRepository.findVisibleCase(user, caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.requireAllowed(authz()
            .subject(user)
            .action(Action.CASE_READ)
            .resource(caseRecord)
            .build());

    return mapper.toDto(caseRecord);
}
```

Kombinasi ini melindungi:

- tenant leakage,
- direct object reference,
- accidental fetch-before-check,
- inconsistent query filter,
- data exposure dari timing/error semantics.

### 3.3 REST Action Semantics

Jangan memetakan authorization hanya ke HTTP method.

```text
GET    /cases/{id}              -> case.read
GET    /cases/{id}/audit        -> case.audit.read
GET    /cases/{id}/documents    -> case.document.list
GET    /cases/{id}/documents/x  -> case.document.download
POST   /cases/{id}/approve      -> case.approve
POST   /cases/{id}/return       -> case.return
POST   /cases/{id}/assign       -> case.assign
DELETE /cases/{id}              -> case.delete or case.withdraw depending domain
```

`POST` bukan satu action. `GET` pun bukan satu permission. Read action punya sensitivitas berbeda.

Contoh:

```text
case.read_summary
case.read_detail
case.read_internal_note
case.read_audit_trail
case.read_attachment
case.export
```

Seorang user mungkin boleh melihat summary tetapi tidak boleh membaca internal note atau audit trail.

### 3.4 REST Bulk Operation

Bulk operation berbahaya karena satu request membawa banyak resource.

```json
{
  "caseIds": ["c1", "c2", "c3"],
  "action": "approve"
}
```

Jangan hanya check:

```java
hasAuthority("case.approve")
```

Harus ada per-item authorization atau scoped query.

```java
public BulkApproveResult approveMany(List<UUID> caseIds) {
    UserContext user = currentUser();

    List<CaseRecord> visibleCases = caseRepository.findVisibleCasesForUpdate(user, caseIds);

    Set<UUID> visibleIds = visibleCases.stream()
            .map(CaseRecord::id)
            .collect(Collectors.toSet());

    List<UUID> inaccessible = caseIds.stream()
            .filter(id -> !visibleIds.contains(id))
            .collect(Collectors.toList());

    if (!inaccessible.isEmpty()) {
        throw new AccessDeniedException("bulk.contains_inaccessible_resource");
    }

    List<PerItemDecision> decisions = visibleCases.stream()
            .map(caseRecord -> authorizationService.decide(authz()
                    .subject(user)
                    .action(Action.CASE_APPROVE)
                    .resource(caseRecord)
                    .build()))
            .collect(Collectors.toList());

    if (decisions.stream().anyMatch(d -> !d.allowed())) {
        throw new AccessDeniedException("bulk.item_denied");
    }

    return caseWorkflow.approveAll(visibleCases);
}
```

Ada dua mode bulk denial:

1. **all-or-nothing** — jika satu denied, seluruh request gagal.
2. **partial success** — item allowed diproses, item denied dilaporkan.

Untuk regulatory/case management, all-or-nothing sering lebih defensible, kecuali requirement eksplisit mendukung partial result.

### 3.5 REST Search and Export

Search sering menjadi bypass object authorization.

```text
GET /cases/{id} aman
GET /cases/search?keyword=... bocor
POST /cases/export bocor
```

Rule penting:

> Search result harus subset dari object yang boleh dibaca user.

Export rule:

> Export bukan hanya read. Export adalah capability berbeda karena meningkatkan blast radius data leakage.

Permission sebaiknya dipisah:

```text
case.search
case.read_summary
case.read_detail
case.export_summary
case.export_detail
case.export_with_attachments
```

Export juga butuh context:

```text
- max row limit,
- purpose,
- data classification,
- approval if sensitive,
- audit event,
- retention of generated file,
- download expiration.
```

---

## 4. GraphQL Authorization

GraphQL mengubah authorization problem karena satu HTTP request bisa memuat banyak field dan resolver.

```graphql
query {
  case(id: "123") {
    id
    status
    applicant {
      name
      nric
    }
    internalNotes {
      body
    }
    auditTrail {
      actor
      action
    }
  }
}
```

REST biasanya punya endpoint berbeda. GraphQL bisa meminta banyak data dalam satu query.

### 4.1 GraphQL Authorization Levels

GraphQL authorization bisa terjadi di beberapa level:

1. operation-level,
2. field-level,
3. resolver-level,
4. object/node-level,
5. edge/relationship-level,
6. mutation-level,
7. input-level,
8. query complexity/depth-level.

### 4.2 Operation-Level Check

Operation-level check menjawab:

```text
Apakah user boleh menjalankan query/mutation ini?
```

Contoh:

```graphql
mutation ApproveCase($id: ID!) {
  approveCase(id: $id) {
    id
    status
  }
}
```

Mapping:

```text
operation: approveCase
permission: case.approve
```

Tetapi operation-level check tidak cukup karena resource ID tetap perlu dicek.

### 4.3 Resolver-Level Authorization

Resolver-level check cocok karena resolver tahu resource yang akan dikembalikan.

```java
public CompletionStage<CaseDto> caseById(DataFetchingEnvironment env) {
    UUID caseId = UUID.fromString(env.getArgument("id"));
    UserContext user = env.getGraphQlContext().get("user");

    return caseService.findVisibleCase(user, caseId)
            .thenApply(caseRecord -> {
                authorizationService.requireAllowed(authz()
                        .subject(user)
                        .action(Action.CASE_READ_DETAIL)
                        .resource(caseRecord)
                        .context("channel", "graphql")
                        .build());

                return mapper.toDto(caseRecord);
            });
}
```

### 4.4 Field-Level Authorization

GraphQL field-level authorization penting untuk sensitive fields.

Contoh:

```graphql
case {
  id
  status
  applicantNric
  internalNotes
  auditTrail
}
```

Bisa jadi user boleh membaca case detail, tetapi tidak boleh membaca `applicantNric` atau `internalNotes`.

Field-level policy:

```text
case.applicant_nric.read
case.internal_note.read
case.audit_trail.read
```

Pseudo-code:

```java
public Object applicantNric(DataFetchingEnvironment env) {
    UserContext user = env.getGraphQlContext().get("user");
    CaseRecord source = env.getSource();

    AuthorizationDecision decision = authorizationService.decide(authz()
            .subject(user)
            .action(Action.CASE_APPLICANT_NRIC_READ)
            .resource(source)
            .context("graphqlField", "Case.applicantNric")
            .build());

    if (!decision.allowed()) {
        return null; // or throw, depending schema contract
    }

    return source.applicantNric();
}
```

Trade-off:

- throwing error is explicit,
- returning null avoids data leak but can hide denial,
- partial data response can confuse clients,
- audit must still capture denied field access if sensitive.

### 4.5 GraphQL Global ID Problem

GraphQL frameworks often use global IDs:

```text
Q2FzZToxMjM=  -> Case:123
```

A global ID is not authorization. It may obscure ID, but does not protect object access.

Vulnerable pattern:

```graphql
query {
  node(id: "Q2FzZToxMjM=") {
    ... on Case {
      id
      status
    }
  }
}
```

Safe pattern:

```text
1. Decode global ID.
2. Resolve resource type + ID.
3. Scope by tenant/relationship.
4. Check object-level authorization.
5. Return only authorized fields.
```

### 4.6 GraphQL N+1 Authorization Problem

GraphQL can create N+1 decision calls.

```graphql
query {
  cases {
    nodes {
      id
      internalNotes { body }
      documents { name downloadUrl }
    }
  }
}
```

Naive resolver:

```text
for each case:
  check case.read
  for each note:
    check note.read
  for each document:
    check document.read
```

Better approach:

- use DataLoader for batching,
- use repository-level scoping,
- use bulk decision API,
- precompute field visibility per resource set,
- separate list authorization from detail authorization.

```java
public interface AuthorizationService {
    Map<ResourceRef, AuthorizationDecision> decideMany(
            SubjectRef subject,
            Action action,
            Collection<ResourceRef> resources,
            AuthorizationContext context
    );
}
```

### 4.7 GraphQL Query Complexity as Authorization Context

GraphQL allows expensive queries. Complexity/depth checks are usually performance controls, but they can also be authorization-related.

Example:

```text
Normal user:
  max query depth 5
  max result size 100

Auditor:
  max query depth 8
  can access auditTrail field

System integration:
  restricted to specific query operations
```

Do not use complexity limit as substitute for authorization. It is a guardrail, not a permission model.

---

## 5. gRPC Authorization

gRPC is common for service-to-service communication. Its authorization problem differs from REST because method names and typed request messages are central.

### 5.1 gRPC Authorization Layers

1. transport-level identity, often mTLS,
2. metadata-level token/context,
3. service/method-level authorization,
4. request message/resource-level authorization,
5. downstream propagation authorization.

Example method:

```protobuf
service CaseCommandService {
  rpc ApproveCase(ApproveCaseRequest) returns (ApproveCaseResponse);
}

message ApproveCaseRequest {
  string case_id = 1;
  string reason = 2;
}
```

Mapping:

```text
gRPC full method: /case.CaseCommandService/ApproveCase
action: case.approve
resource: case:{case_id}
context: peer service, deadline, tenant, trace ID
```

### 5.2 ServerInterceptor as PEP

A gRPC `ServerInterceptor` can act as PEP for method-level authorization.

```java
public final class AuthorizationServerInterceptor implements ServerInterceptor {
    private final AuthorizationService authorizationService;

    public AuthorizationServerInterceptor(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next
    ) {
        String fullMethodName = call.getMethodDescriptor().getFullMethodName();
        SubjectRef subject = subjectFromMetadata(headers);

        AuthorizationDecision decision = authorizationService.decide(authz()
                .subject(subject)
                .action(actionFromGrpcMethod(fullMethodName))
                .resource(ResourceRef.serviceMethod(fullMethodName))
                .context("protocol", "grpc")
                .build());

        if (!decision.allowed()) {
            call.close(Status.PERMISSION_DENIED.withDescription("access denied"), new Metadata());
            return new ServerCall.Listener<ReqT>() {};
        }

        return next.startCall(call, headers);
    }
}
```

This is useful but incomplete for object-level authorization because interceptor usually does not yet inspect the request message deeply.

### 5.3 Message-Level Authorization

For resource-specific decisions, service implementation must authorize using request payload.

```java
public void approveCase(
        ApproveCaseRequest request,
        StreamObserver<ApproveCaseResponse> responseObserver
) {
    UserContext user = userContext.current();
    UUID caseId = UUID.fromString(request.getCaseId());

    CaseRecord caseRecord = caseRepository.findVisibleForUpdate(user, caseId)
            .orElseThrow(() -> grpcNotFoundOrDenied());

    authorizationService.requireAllowed(authz()
            .subject(user)
            .action(Action.CASE_APPROVE)
            .resource(caseRecord)
            .context("grpcMethod", "CaseCommandService/ApproveCase")
            .build());

    CaseRecord approved = caseWorkflow.approve(caseRecord, request.getReason());
    responseObserver.onNext(toResponse(approved));
    responseObserver.onCompleted();
}
```

### 5.4 gRPC Streaming Authorization

Streaming RPC adds complexity.

Types:

1. server streaming,
2. client streaming,
3. bidirectional streaming.

For streaming, authorization may need to happen:

- at stream open,
- per message,
- per emitted resource,
- when context changes,
- when subscription scope changes.

Example:

```text
SubscribeCaseEvents(tenantId, filters)
```

Opening stream check:

```text
Can subject subscribe to case events for tenant X?
```

Per event check:

```text
Can subject see this specific case event?
```

Do not assume stream-open authorization covers every emitted item.

### 5.5 Service-to-Service gRPC

In service-to-service calls, subject can mean:

1. workload identity,
2. end-user identity propagated from upstream,
3. delegated authority,
4. both workload and user.

A robust context distinguishes:

```java
public final class DistributedSubject {
    private final ServiceIdentity callerService;
    private final Optional<UserIdentity> endUser;
    private final Optional<DelegationChain> delegationChain;
}
```

Important invariant:

> A downstream service should not accept “user says they can do X” from upstream. It should accept identity/context evidence and make or verify its own authorization decision appropriate to its boundary.

---

## 6. WebSocket and SSE Authorization

WebSocket and SSE introduce long-lived connections. Authorization cannot be treated as a one-time HTTP request check only.

### 6.1 WebSocket Authorization Points

1. handshake authorization,
2. connection/session authorization,
3. subscription authorization,
4. message send authorization,
5. per-event emission filtering,
6. re-authorization on permission change,
7. disconnect on revocation.

Example:

```text
CONNECT /ws
SUBSCRIBE /topic/cases/{caseId}
SEND /app/cases/{caseId}/comment
```

Handshake only confirms that the user can open WebSocket. It does not mean the user can subscribe to every topic.

### 6.2 Subscription Authorization

```java
public void authorizeSubscription(UserContext user, String destination) {
    Destination dest = Destination.parse(destination);

    if (dest.type() == DestinationType.CASE_TOPIC) {
        CaseRecord caseRecord = caseRepository.findVisibleCase(user, dest.caseId())
                .orElseThrow(AccessDeniedException::new);

        authorizationService.requireAllowed(authz()
                .subject(user)
                .action(Action.CASE_EVENT_SUBSCRIBE)
                .resource(caseRecord)
                .context("channel", "websocket")
                .build());
    }
}
```

### 6.3 Event Emission Filtering

Even after subscription, each event may need filtering.

```text
User subscribed to agency-level case updates.
Event emitted for case from another agency.
Must filter before sending.
```

Safe architecture:

```text
Producer emits domain event
  -> event fanout service loads subscriber scope
  -> per-subscriber authorization/filtering
  -> send only allowed event projection
```

Do not send full domain event to client and ask frontend to hide fields.

### 6.4 SSE

SSE is one-way, but same risks apply:

- connection open check,
- stream scope check,
- per-event filtering,
- revocation handling,
- audit if sensitive.

SSE often looks harmless because it is “just notification”, but notification can leak existence:

```text
Case 123 escalated
Case assigned to enforcement unit
Applicant name updated
```

Existence and metadata can be sensitive.

---

## 7. File Upload and Download Authorization

File endpoints are a major bypass area.

### 7.1 Download Is Not Generic Read

```text
GET /documents/{documentId}/download
```

Must check:

```text
subject can download this exact document
subject can access parent case/application
document classification is allowed
file is not quarantined/deleted/sealed
request channel is allowed
watermark/logging required if sensitive
```

Permission naming:

```text
case.document.list
case.document.read_metadata
case.document.preview
case.document.download
case.document.download_sensitive
case.document.delete
case.document.upload
```

### 7.2 Signed URL Pitfall

Many systems generate pre-signed S3 URLs.

Dangerous pattern:

```text
User authorized once to get URL.
URL valid for too long.
URL forwarded to unauthorized party.
No download audit after issuance.
```

Safer pattern:

- short TTL,
- bind to object and purpose,
- audit URL issuance,
- avoid embedding broad bucket/key access,
- consider proxy download for highly sensitive data,
- watermark or label file if required,
- do not expose predictable storage keys.

### 7.3 Upload Authorization

Upload also needs authorization.

Check:

```text
Can user upload document to this parent resource?
Can user upload this document type?
Is parent resource in state that accepts upload?
Is file classification allowed?
Does user have quota?
Does malware scan pass before document becomes visible?
```

Upload is often a two-phase flow:

```text
1. authorize create upload session
2. upload to storage
3. scan/validate
4. attach to domain resource
5. authorize final attach/publish
```

---

## 8. Webhook Authorization

Webhook endpoint receives calls from external systems.

Webhook security often starts with signature verification, but authorization still matters.

### 8.1 Webhook Identity

Subject may be:

```text
external-system:payment-gateway
external-system:identity-provider
external-system:document-scanner
partner:agency-x
```

Action:

```text
webhook.payment.status_update
webhook.identity.profile_update
webhook.document.scan_result
```

Resource:

```text
external event ID
internal correlated case/application/payment/document
```

Context:

```text
signature valid?
timestamp within replay window?
source IP allowlisted?
event type?
tenant mapping?
correlation ID?
```

### 8.2 Webhook Authorization Flow

```text
1. Verify transport security.
2. Verify signature.
3. Verify timestamp/replay protection.
4. Identify external caller.
5. Parse event type.
6. Map event to allowed actions for caller.
7. Resolve internal resource.
8. Enforce domain authorization/invariant.
9. Process idempotently.
10. Audit decision and event.
```

Example:

```java
public void handleWebhook(WebhookRequest request) {
    ExternalCaller caller = webhookVerifier.verify(request);
    WebhookEvent event = webhookParser.parse(request.body());

    authorizationService.requireAllowed(authz()
            .subject(SubjectRef.externalSystem(caller.id()))
            .action(Action.webhook(event.type()))
            .resource(ResourceRef.externalEvent(event.id()))
            .context("signatureVerified", true)
            .context("source", caller.id())
            .build());

    webhookApplicationService.process(caller, event);
}
```

Webhook verification answers “is this really X?” Authorization answers “is X allowed to perform this event/action against this resource/context?”

---

## 9. Messaging Authorization: Kafka, RabbitMQ, JMS

Messaging is where authorization bugs hide because message consumers are often treated as trusted internal code.

### 9.1 Broker-Level Authorization vs Domain Authorization

Broker-level authorization:

```text
Can service A publish to topic T?
Can service B consume queue Q?
```

Domain authorization:

```text
Should this message cause this case to transition?
Was the initiating user allowed?
Is the event valid for this tenant/resource?
Is this consumer allowed to process this resource type?
```

Both are needed.

### 9.2 Message Producer Authorization

Before publishing a command/event, authorize the intent.

```java
public void requestCaseApproval(UUID caseId) {
    UserContext user = currentUser();
    CaseRecord caseRecord = caseRepository.findVisibleForUpdate(user, caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.requireAllowed(authz()
            .subject(user)
            .action(Action.CASE_APPROVE_REQUEST)
            .resource(caseRecord)
            .context("channel", "rest")
            .build());

    eventPublisher.publish(new CaseApprovalRequested(
            caseId,
            user.userId(),
            user.tenantId(),
            correlationId.current()
    ));
}
```

### 9.3 Message Consumer Authorization

Consumer should not blindly trust messages.

```java
@KafkaListener(topics = "case-commands")
public void onCaseApprovalRequested(CaseApprovalRequested event) {
    InitiatingActor actor = actorResolver.resolve(event.initiatedBy());
    CaseRecord caseRecord = caseRepository.findById(event.caseId())
            .orElseThrow();

    authorizationService.requireAllowed(authz()
            .subject(actor.asSubject())
            .action(Action.CASE_APPROVE)
            .resource(caseRecord)
            .context("channel", "kafka")
            .context("eventType", "CaseApprovalRequested")
            .context("correlationId", event.correlationId())
            .build());

    caseWorkflow.approve(caseRecord);
}
```

There are two identities:

1. **consumer service identity** — can this service process this topic?
2. **initiating actor identity** — was the original user/system allowed to trigger the business action?

Do not confuse them.

### 9.4 Event vs Command Authorization

Events report what happened. Commands request something to happen.

```text
Event:
  CaseSubmitted
  CaseApproved
  DocumentUploaded

Command:
  ApproveCase
  AssignCase
  GenerateReport
```

Authorization is usually stricter for commands because they initiate changes.

But events can also leak data. Event consumers need authorization/scope controls if events contain sensitive data.

### 9.5 Message Payload Minimization

Do not put sensitive full data in broad topics.

Bad:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "123",
  "applicantNric": "...",
  "internalNotes": "...",
  "fullPayload": { ... }
}
```

Better:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "123",
  "tenantId": "agency-a",
  "changedFields": ["status"],
  "classification": "INTERNAL"
}
```

Consumers that need detail should call an authorized read API or use a scoped projection.

### 9.6 Retry and Dead Letter Authorization

Retries and DLQ can bypass current permissions if not designed.

Example:

```text
User had permission at time T1.
Message fails and retries at T2.
Permission revoked before T2.
Should command still execute?
```

You need a policy:

1. **decision at initiation time** — event carries authorized decision snapshot;
2. **decision at execution time** — consumer rechecks current authorization;
3. **both** — initiation must be authorized and execution must still be valid.

For high-risk state changes, prefer both.

### 9.7 Scheduled Jobs and Batch Consumers

Batch jobs often run under service account.

Question:

```text
Is the service account allowed to process all tenants/resources?
Or only a scoped dataset?
```

Batch job should have explicit scope:

```java
public final class BatchAuthorizationContext {
    private final String jobName;
    private final Set<TenantId> tenantScope;
    private final String purpose;
    private final String runId;
}
```

Do not let service account become invisible super-admin.

---

## 10. Internal API Authorization

Internal APIs are not automatically trusted.

Common weak assumption:

```text
This endpoint is internal, so no authorization needed.
```

Better model:

```text
Internal network reduces exposure, but does not remove authorization requirement.
```

Threats:

- compromised internal service,
- SSRF into internal endpoint,
- misconfigured gateway,
- lateral movement,
- developer/debug tool exposure,
- environment routing mistakes,
- confused deputy.

Internal API should still check:

```text
caller service identity,
allowed action,
resource scope,
tenant boundary,
end-user delegation if applicable.
```

Example:

```java
public void internalReassignCase(ReassignCaseRequest request) {
    ServiceIdentity caller = serviceIdentityContext.current();

    authorizationService.requireAllowed(authz()
            .subject(SubjectRef.service(caller.name()))
            .action(Action.INTERNAL_CASE_REASSIGN)
            .resource(ResourceRef.caseId(request.caseId()))
            .context("tenantId", request.tenantId())
            .context("internal", true)
            .build());

    reassignService.reassign(request);
}
```

---

## 11. Human User vs Workload Identity

Many authorization mistakes happen because systems collapse all callers into “user”.

Actually there are multiple caller types:

```text
human user
service account
batch job
external partner system
support operator
automation rule
scheduler
webhook source
AI agent/tooling process
```

Each subject type should be modeled explicitly.

```java
public sealed interface SubjectRef permits UserSubject, ServiceSubject, ExternalSystemSubject, BatchJobSubject {
    String subjectId();
    SubjectKind kind();
}
```

For Java 8 compatibility, use class hierarchy without sealed types:

```java
public interface SubjectRef {
    String subjectId();
    SubjectKind kind();
}
```

Top-level rule:

> Do not give service accounts broad invisible power. Give them explicit capabilities, scope, purpose, and audit identity.

---

## 12. Cross-Protocol Authorization Matrix

For a serious system, create a matrix like this:

| Operation | REST | GraphQL | gRPC | Messaging | Batch | File | Required invariant |
|---|---|---|---|---|---|---|---|
| Read case summary | `GET /cases/{id}` | `case(id)` | `GetCase` | projection event | report job | n/a | tenant + visibility |
| Read internal note | `GET /cases/{id}/notes` | `internalNotes` | `GetInternalNotes` | restricted topic | audit extract | n/a | privileged role + assignment |
| Approve case | `POST /cases/{id}/approve` | `approveCase` | `ApproveCase` | `ApproveCaseCommand` | auto-approval job | n/a | state + role + SoD |
| Download document | `/documents/{id}` | `downloadUrl` | `GetDocumentUrl` | n/a | archive job | signed URL | parent access + classification |
| Export cases | `/cases/export` | n/a | `ExportCases` | export command | scheduled export | generated file | export permission + scope |

This matrix exposes missing enforcement paths.

If the same business operation exists across protocols, it should eventually call the same domain authorization policy.

---

## 13. Error Semantics by Protocol

| Protocol | Denial response |
|---|---|
| REST | `403`, sometimes masked as `404` |
| GraphQL | field error, null field, or operation error |
| gRPC | `PERMISSION_DENIED` or masked `NOT_FOUND` |
| WebSocket | reject subscription, send error frame, close session |
| SSE | reject stream or filter events |
| Kafka/Rabbit/JMS | reject/drop/DLQ/compensate depending semantics |
| Batch | fail job, skip item, quarantine item |
| Webhook | `403`, `401`, `400`, or idempotent ignore depending verification/authorization |

Be careful with masking.

Masking resource existence can be appropriate:

```text
GET /cases/other-tenant-id -> 404
```

But for operator troubleshooting and audit, internal reason should still be recorded:

```text
external response: 404
internal audit: denied: tenant_mismatch
```

---

## 14. Java 8 to 25 Considerations

Authorization design can be Java-version-neutral, but implementation style changes.

### 14.1 Java 8 Baseline

Use:

- immutable classes,
- interfaces,
- enums,
- `Optional` carefully,
- explicit builders,
- thread-safe context handling,
- servlet filters/interceptors.

Avoid relying on:

- records,
- sealed types,
- pattern matching,
- virtual threads.

### 14.2 Java 11/17

Useful improvements:

- better HTTP client for remote PDP integration,
- records in Java 16+ for compact immutable DTOs,
- sealed classes in Java 17 for subject/action/resource type hierarchy,
- stronger baseline for modern Spring/Jakarta runtimes.

### 14.3 Java 21/25

Relevant considerations:

- virtual threads can increase concurrency of authorization calls;
- remote PDP latency becomes easier to tolerate operationally but not logically free;
- structured concurrency can help group bulk authorization calls;
- pattern matching can simplify decision model handling;
- observability remains critical because more concurrency can hide denial storms.

Do not confuse improved concurrency with better security. Authorization correctness still depends on invariant design.

---

## 15. Testing Strategy Across Protocols

### 15.1 REST Tests

- route-level allow/deny,
- object-level access,
- tenant mismatch,
- bulk item denial,
- export scope,
- file download denial,
- masked `404` behavior.

### 15.2 GraphQL Tests

- unauthorized operation,
- unauthorized field,
- unauthorized global ID,
- nested resolver leakage,
- query result filtering,
- mutation object-level denial,
- partial response semantics.

### 15.3 gRPC Tests

- interceptor denies method,
- service implementation denies resource,
- metadata missing/invalid,
- service identity denied,
- streaming per-message filtering.

### 15.4 Messaging Tests

- unauthorized command not published,
- unauthorized command not executed,
- stale permission retry behavior,
- DLQ does not leak sensitive payload,
- consumer verifies tenant/resource,
- service account scoped.

### 15.5 Cross-Protocol Golden Tests

Create golden decision tests independent of protocol.

```java
@Test
public void makerCannotApproveOwnCase_acrossAllChannels() {
    AuthorizationScenario scenario = scenario()
            .subject(caseMaker)
            .resource(caseSubmittedBy(caseMaker))
            .action(Action.CASE_APPROVE)
            .build();

    assertDenied(policy.decide(scenario.asRestContext()));
    assertDenied(policy.decide(scenario.asGraphQlContext()));
    assertDenied(policy.decide(scenario.asGrpcContext()));
    assertDenied(policy.decide(scenario.asKafkaContext()));
}
```

The invariant is the same even when protocol context changes.

---

## 16. Production Checklist

Use this checklist before approving an architecture.

### 16.1 Entry Point Inventory

- [ ] REST endpoints inventoried.
- [ ] GraphQL queries/mutations/fields inventoried.
- [ ] gRPC services/methods inventoried.
- [ ] WebSocket destinations inventoried.
- [ ] SSE streams inventoried.
- [ ] Kafka topics/consumers inventoried.
- [ ] RabbitMQ queues/exchanges inventoried.
- [ ] JMS destinations inventoried.
- [ ] Scheduled jobs inventoried.
- [ ] Webhooks inventoried.
- [ ] File upload/download endpoints inventoried.
- [ ] Internal/admin/debug endpoints inventoried.

### 16.2 Enforcement

- [ ] Every entry point has a PEP.
- [ ] Business operations share domain authorization policy.
- [ ] Object-level authorization exists for resource IDs.
- [ ] Query/list/export use scoped queries.
- [ ] Bulk operations authorize every item or enforce scoped all-or-nothing.
- [ ] File access checks parent resource and classification.
- [ ] Messaging consumers do not blindly trust messages.
- [ ] Service accounts have explicit scope.

### 16.3 Audit and Observability

- [ ] Denied decisions have reason code.
- [ ] Sensitive allowed decisions are audited.
- [ ] Cross-protocol decision has correlation ID.
- [ ] Policy version is logged.
- [ ] Subject type is logged.
- [ ] Resource type/ID is logged safely.
- [ ] Denial storm alerts exist.

### 16.4 Failure Handling

- [ ] PDP unavailable behavior defined.
- [ ] Attribute source failure behavior defined.
- [ ] Messaging retry authorization behavior defined.
- [ ] Stream revocation behavior defined.
- [ ] Signed URL expiry defined.
- [ ] Webhook replay protection defined.

---

## 17. Anti-Patterns

### Anti-Pattern 1 — “REST Is Secured, So System Is Secured”

False. GraphQL, gRPC, message consumers, jobs, and exports may bypass REST controller checks.

### Anti-Pattern 2 — “Internal Means Trusted”

Internal network is not authorization. It is at most one signal.

### Anti-Pattern 3 — “Broker ACL Is Domain Authorization”

Kafka/Rabbit/JMS ACL controls topic/queue access, not whether a business transition is allowed.

### Anti-Pattern 4 — “GraphQL Field Hiding in UI”

Frontend hiding is not enforcement. Sensitive fields must be protected in resolver/server.

### Anti-Pattern 5 — “Signed URL Means Authorized Forever”

Signed URL is delegated access. TTL, scope, audit, and classification matter.

### Anti-Pattern 6 — “Service Account Can Do Everything”

Service account should have explicit, minimal, auditable capabilities.

### Anti-Pattern 7 — “Check Once at Stream Start”

Long-lived stream needs per-subscription/per-event thinking and revocation strategy.

### Anti-Pattern 8 — “Message Carries User ID, Therefore Authorized”

User ID in message is evidence, not a decision. It can be stale, forged, or out of scope unless protected and validated.

---

## 18. Top 1% Insight

A strong engineer sees authorization as a **semantic invariant crossing protocols**.

Weak design:

```text
REST has @PreAuthorize.
GraphQL has some resolver checks.
gRPC trusts internal caller.
Kafka consumer trusts message.
Batch job uses admin service account.
Export has separate SQL.
File download uses signed URL.
```

Strong design:

```text
All entry points map into the same authorization vocabulary:
  subject, action, resource, context.

Every business operation has one domain-level authorization policy.
Every data-revealing path has query/data-level scoping.
Every asynchronous path carries auditable initiation context.
Every privileged workload has explicit scope.
Every deny/allow can be explained after the fact.
```

The protocol may differ. The invariant must not.

---

## 19. Summary

REST, GraphQL, gRPC, WebSocket, SSE, file endpoints, webhooks, messaging, internal APIs, and batch jobs all need authorization. The shape differs, but the decision model remains stable:

```text
Subject + Action + Resource + Context + Policy -> Decision
```

The most important engineering move is to avoid protocol-local authorization logic becoming fragmented. Use protocol adapters as PEPs, but centralize business authorization semantics in reusable policy/domain services.

A top-level authorization design must ensure:

- every entry point is inventoried,
- every resource ID has object-level enforcement,
- every query/export path is scoped,
- every async path carries actor/context evidence,
- every service account is constrained,
- every sensitive decision is auditable,
- every protocol maps to the same invariant vocabulary.

---

## 20. References

- Spring Security Reference — Authorize HttpServletRequests: `https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html`
- Spring Security Reference — Authorization Architecture: `https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html`
- OWASP API Security 2023 — API1 Broken Object Level Authorization: `https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/`
- OWASP Authorization Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html`
- GraphQL Java Documentation — Instrumentation: `https://www.graphql-java.com/documentation/instrumentation/`
- gRPC Documentation — Interceptors: `https://grpc.io/docs/guides/interceptors/`
- gRPC Java Javadoc — ServerInterceptor: `https://grpc.github.io/grpc-java/javadoc/io/grpc/ServerInterceptor.html`
- gRPC Documentation — Metadata: `https://grpc.io/docs/guides/metadata/`
- Apache Kafka Documentation — Security: `https://kafka.apache.org/documentation/#security`
- RabbitMQ Documentation — Access Control: `https://www.rabbitmq.com/docs/access-control`
- Jakarta Messaging Specification: `https://jakarta.ee/specifications/messaging/`

---

## 21. Status Seri

Selesai:

```text
[x] Part 0  — Authorization Mental Model
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
[x] Part 11 — IDOR, BOLA, and Object-Level Authorization
[x] Part 12 — Authorization in Layered Java Applications
[x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
[x] Part 14 — Spring Method Security: Service-Level Authorization
[x] Part 15 — Spring Domain Authorization Patterns
[x] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
[x] Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
```

Berikutnya:

```text
[ ] Part 18 — Data-Level Authorization and Query Scoping
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-016.md">⬅️ Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-018.md">Part 18 — Data-Level Authorization and Query Scoping ➡️</a>
</div>
