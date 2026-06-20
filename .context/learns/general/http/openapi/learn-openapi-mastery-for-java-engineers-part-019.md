# OpenAPI Mastery for Java Engineers — Part 019

# Hypermedia, Links, Callbacks, Webhooks, and Asynchronous Interaction Modelling

**Filename:** `learn-openapi-mastery-for-java-engineers-part-019.md`  
**Series:** `learn-openapi-mastery-for-java-engineers`  
**Part:** `019 / 030`  
**Audience:** Java software engineer, tech lead, backend/platform/API engineer  
**Main theme:** Modelling API interactions that do not end at a single synchronous request-response.

---

## 0. Why This Part Matters

Most engineers first learn OpenAPI through simple CRUD examples:

```text
GET /customers/{id}
POST /customers
PUT /customers/{id}
DELETE /customers/{id}
```

That is useful, but real systems rarely stop there.

Production APIs often involve:

- long-running operations,
- approvals,
- state transitions,
- async processing,
- background jobs,
- callbacks,
- webhooks,
- user journeys,
- external partner notifications,
- eventual consistency,
- retry and reconciliation,
- evidence submission,
- file processing,
- regulatory workflow,
- payment authorization,
- fraud review,
- enforcement actions,
- investigation lifecycle,
- escalation and appeal.

If you model these APIs as if every operation is synchronous and complete immediately, your OpenAPI document lies.

And a lying OpenAPI contract is worse than no contract, because it creates false confidence.

This part teaches how to model interactions where the meaningful business outcome happens after the initial HTTP response.

---

## 1. Core Mental Model

A synchronous HTTP response answers one narrow question:

```text
Did the server receive and process this HTTP request enough to return an HTTP response?
```

It does not necessarily answer:

```text
Is the business process complete?
Was the command accepted permanently?
Did downstream processing succeed?
Was the case assigned?
Was the document scanned?
Was the enforcement decision finalized?
Was the callback delivered?
Did all consumers observe the result?
```

OpenAPI can describe more than simple input/output shapes. It can describe parts of the interaction graph:

- what operation can be called next,
- where a resource can be retrieved,
- how async completion may be delivered,
- what callback payloads look like,
- what webhook events are exposed,
- what correlation identifiers are required,
- what status resource represents a long-running operation.

The critical shift:

```text
Endpoint thinking:
  This request returns this response.

Interaction thinking:
  This operation starts or advances a lifecycle, and the consumer needs a safe way to observe, continue, retry, cancel, or reconcile it.
```

---

## 2. Terminology

Before going deeper, separate these terms carefully.

### 2.1 Synchronous Operation

A synchronous operation completes the meaningful work before the response is returned.

Example:

```text
GET /cases/C-1001
```

The consumer asks for the current case representation. The response contains it.

### 2.2 Asynchronous Operation

An asynchronous operation accepts a request, but the meaningful business work continues after the HTTP response.

Example:

```text
POST /evidence-packages
```

The server accepts a large evidence package for virus scanning, OCR extraction, metadata indexing, and case association. The response returns a job ID, not the final processed result.

### 2.3 Long-Running Operation

A long-running operation is an async operation with an explicit status lifecycle.

Example lifecycle:

```text
accepted -> queued -> running -> waiting_for_manual_review -> completed
                                             \-> failed
                                             \-> cancelled
```

### 2.4 Polling

Polling means the consumer repeatedly calls a status endpoint.

Example:

```text
GET /operations/op_123
```

### 2.5 Callback

A callback is an HTTP request made by the provider back to a consumer-specified URL as part of an operation.

In OpenAPI, a `callbacks` object lets an operation describe requests that the API provider may initiate later.

### 2.6 Webhook

A webhook is an event notification endpoint exposed by the consumer and called by the provider when something happens.

In OpenAPI 3.1+ and 3.2, top-level `webhooks` can describe incoming webhook requests from the provider's perspective.

### 2.7 Hypermedia Link

A link describes a possible relationship from one operation response to another operation.

It answers:

```text
Given this response, what operation can the client call next, and what values should it pass?
```

### 2.8 Event Stream

An event stream continuously emits events over a streaming transport or protocol.

OpenAPI can describe HTTP-based streaming in limited ways, but for event-first systems, AsyncAPI is usually the better modelling language.

---

## 3. The Four Common Async API Patterns

Most async HTTP APIs use one or more of these patterns.

```text
Pattern 1: 202 + status resource
Pattern 2: 202 + callback URL
Pattern 3: 202 + webhook subscription/event
Pattern 4: synchronous response + later resource state change
```

Each has different contract obligations.

---

## 4. Pattern 1 — `202 Accepted` + Status Resource

This is the safest baseline pattern for long-running operations.

### 4.1 Flow

```text
Client                       Server
  |                            |
  | POST /evidence-packages    |
  |--------------------------->|
  |                            | validate request shape
  |                            | authorize caller
  |                            | persist command/job
  |                            | enqueue processing
  | 202 Accepted               |
  | Location: /operations/op1  |
  |<---------------------------|
  |                            |
  | GET /operations/op1        |
  |--------------------------->|
  | 200 { status: running }    |
  |<---------------------------|
  |                            |
  | GET /operations/op1        |
  |--------------------------->|
  | 200 { status: completed }  |
  |<---------------------------|
```

### 4.2 Why It Works Well

This pattern is robust because:

- the initial request does not pretend work is complete,
- the client gets a durable operation resource,
- status can be retried safely,
- failure details can be represented explicitly,
- progress can be exposed without blocking HTTP connections,
- manual review states can be modelled,
- cancellation can be added later,
- callback/webhook can be added as an enhancement.

### 4.3 Minimal OpenAPI Example

```yaml
paths:
  /evidence-packages:
    post:
      operationId: submitEvidencePackage
      summary: Submit an evidence package for asynchronous processing
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SubmitEvidencePackageRequest'
      responses:
        '202':
          description: Evidence package accepted for asynchronous processing.
          headers:
            Location:
              description: URL of the operation status resource.
              schema:
                type: string
                format: uri-reference
            Retry-After:
              description: Suggested minimum number of seconds before polling.
              schema:
                type: integer
                minimum: 1
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OperationAcceptedResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          $ref: '#/components/responses/Conflict'
```

Operation status endpoint:

```yaml
  /operations/{operationId}:
    get:
      operationId: getOperationStatus
      summary: Get the status of a long-running operation
      parameters:
        - name: operationId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Current operation status.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OperationStatus'
        '404':
          $ref: '#/components/responses/NotFound'
```

Schemas:

```yaml
components:
  schemas:
    OperationAcceptedResponse:
      type: object
      required:
        - operationId
        - status
        - statusUrl
      properties:
        operationId:
          type: string
          example: op_01HXZ7R9G9W3T2C6Y0ME7D2Q6X
        status:
          type: string
          enum: [accepted]
        statusUrl:
          type: string
          format: uri-reference
          example: /operations/op_01HXZ7R9G9W3T2C6Y0ME7D2Q6X

    OperationStatus:
      type: object
      required:
        - operationId
        - status
        - createdAt
        - updatedAt
      properties:
        operationId:
          type: string
        status:
          type: string
          enum:
            - accepted
            - queued
            - running
            - waiting_for_manual_review
            - completed
            - failed
            - cancelled
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        progress:
          type: object
          properties:
            percent:
              type: integer
              minimum: 0
              maximum: 100
            message:
              type: string
        result:
          $ref: '#/components/schemas/OperationResult'
        error:
          $ref: '#/components/schemas/Problem'
```

### 4.4 Important Contract Questions

For any `202 Accepted` operation, your OpenAPI should make these questions answerable:

1. Was the request merely received, or durably persisted?
2. What resource represents the operation?
3. How should the client poll?
4. Is `Retry-After` used?
5. What are terminal states?
6. What are retryable states?
7. Can the operation fail after initial acceptance?
8. How are business validation failures surfaced after acceptance?
9. Is cancellation supported?
10. Is the result embedded in the operation resource or linked separately?
11. How long is the operation resource retained?
12. Can the same idempotency key find the same operation again?
13. What happens if the consumer loses the initial response?

A top-tier OpenAPI contract does not necessarily answer all of these in machine-readable fields, but it should not leave critical lifecycle behaviour implicit.

---

## 5. Pattern 2 — `202 Accepted` + Callback URL

In this pattern, the client provides a callback URL, and the provider calls it later.

### 5.1 Flow

```text
Client                                     Server
  |                                          |
  | POST /screening-jobs                     |
  | { callbackUrl: https://client/callback } |
  |----------------------------------------->|
  |                                          | accept job
  | 202 Accepted                             |
  |<-----------------------------------------|
  |                                          |
  |                    POST client callback  |
  |<-----------------------------------------|
  | 204 No Content                           |
  |----------------------------------------->|
```

### 5.2 When This Pattern Is Useful

Use callbacks when:

- the client cannot or should not poll frequently,
- processing duration is unpredictable,
- external partner integrations need push notifications,
- downstream business processes require active notification,
- humans are waiting on workflow state changes,
- high-volume polling would be wasteful.

### 5.3 When This Pattern Is Dangerous

Callbacks introduce operational and security complexity:

- callback endpoint authentication,
- TLS requirements,
- retries,
- duplicate delivery,
- timeout handling,
- consumer downtime,
- signature verification,
- SSRF risk if arbitrary callback URLs are accepted,
- payload compatibility,
- replay protection,
- delivery audit.

Do not introduce callbacks just because they feel more elegant than polling.

Polling is often simpler and more reliable.

### 5.4 OpenAPI Callback Example

```yaml
paths:
  /screening-jobs:
    post:
      operationId: createScreeningJob
      summary: Create a screening job with completion callback
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateScreeningJobRequest'
      responses:
        '202':
          description: Screening job accepted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OperationAcceptedResponse'
      callbacks:
        screeningCompleted:
          '{$request.body#/callbackUrl}':
            post:
              operationId: receiveScreeningCompletedCallback
              summary: Callback sent when screening job reaches a terminal state
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      $ref: '#/components/schemas/ScreeningJobCallback'
              responses:
                '204':
                  description: Callback accepted.
```

Request schema:

```yaml
components:
  schemas:
    CreateScreeningJobRequest:
      type: object
      required:
        - subjectId
        - callbackUrl
      properties:
        subjectId:
          type: string
        callbackUrl:
          type: string
          format: uri
          description: HTTPS endpoint that will receive completion callback.

    ScreeningJobCallback:
      type: object
      required:
        - operationId
        - status
        - occurredAt
      properties:
        operationId:
          type: string
        status:
          type: string
          enum: [completed, failed]
        occurredAt:
          type: string
          format: date-time
        result:
          $ref: '#/components/schemas/ScreeningResult'
        error:
          $ref: '#/components/schemas/Problem'
```

### 5.5 Runtime Expressions

The callback URL in this example uses a runtime expression:

```yaml
'{$request.body#/callbackUrl}'
```

This means:

```text
Use the value of callbackUrl from the original request body as the callback target.
```

Runtime expressions can reference parts of:

- the request,
- the response,
- path parameters,
- query parameters,
- headers,
- body values.

This allows OpenAPI to model callbacks whose destination is not statically known.

### 5.6 Security Warning

Accepting arbitrary callback URLs is risky.

A malicious caller might supply:

```text
http://localhost:8080/admin
http://169.254.169.254/latest/meta-data/
https://internal-service.local/private
```

That can create SSRF-style risk.

Production systems usually need one or more controls:

- require HTTPS,
- restrict allowed callback domains,
- pre-register callback endpoints,
- verify endpoint ownership,
- sign callback payloads,
- include event IDs,
- include timestamps,
- reject private network addresses,
- avoid following redirects,
- enforce timeout and retry limits.

OpenAPI can describe some expectations, but security enforcement must live in implementation and platform controls.

---

## 6. Pattern 3 — Webhook Subscription and Event Notification

Callbacks are often operation-specific. Webhooks are often event-subscription based.

### 6.1 Flow

```text
Consumer registers subscription:

POST /webhook-subscriptions
{
  "eventTypes": ["case.escalated", "case.closed"],
  "targetUrl": "https://consumer.example.com/webhooks/regulatory-events"
}

Provider later sends event:

POST https://consumer.example.com/webhooks/regulatory-events
{
  "eventId": "evt_123",
  "eventType": "case.escalated",
  "occurredAt": "2026-06-20T10:15:30Z",
  "data": { ... }
}
```

### 6.2 Webhook vs Callback

```text
Callback:
  Usually tied to a specific operation initiated by the client.

Webhook:
  Usually tied to a subscription or event type, not just one request.
```

Example callback:

```text
Tell me when this screening job completes.
```

Example webhook:

```text
Tell me whenever any case assigned to my agency is escalated.
```

### 6.3 OpenAPI Top-Level Webhooks

OpenAPI 3.1+ supports top-level `webhooks`.

Example:

```yaml
openapi: 3.2.0
info:
  title: Regulatory Case API
  version: 1.0.0

webhooks:
  caseEscalated:
    post:
      operationId: receiveCaseEscalatedWebhook
      summary: Webhook delivered when a case is escalated
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CaseEscalatedEvent'
      responses:
        '204':
          description: Event accepted.
        '400':
          description: Invalid event payload.
        '401':
          description: Invalid signature or authentication failure.
```

Event schema:

```yaml
components:
  schemas:
    CaseEscalatedEvent:
      type: object
      required:
        - eventId
        - eventType
        - occurredAt
        - data
      properties:
        eventId:
          type: string
          description: Unique event identifier for idempotent processing.
        eventType:
          type: string
          const: case.escalated
        occurredAt:
          type: string
          format: date-time
        data:
          type: object
          required:
            - caseId
            - previousQueue
            - newQueue
            - reasonCode
          properties:
            caseId:
              type: string
            previousQueue:
              type: string
            newQueue:
              type: string
            reasonCode:
              type: string
```

### 6.4 Webhook Contract Obligations

A production-grade webhook contract should document:

- event type,
- event ID,
- event timestamp,
- delivery timestamp if different,
- payload schema,
- idempotency expectation,
- retry behaviour,
- timeout behaviour,
- authentication/signature scheme,
- ordering guarantees or lack thereof,
- duplicate delivery possibility,
- event versioning,
- deprecation process,
- subscription management,
- delivery failure handling,
- replay or redelivery endpoint if available.

OpenAPI can describe payloads and endpoints. Narrative documentation should cover delivery semantics.

---

## 7. Pattern 4 — Synchronous Response + Later Resource State Change

Sometimes an API returns `200` or `201`, but the returned resource is not final.

Example:

```text
POST /cases/C-1001/evidence
201 Created
{
  "evidenceId": "EV-9001",
  "status": "pending_scan"
}
```

The evidence exists, but it is not yet usable. It still needs virus scanning, OCR extraction, redaction, or manual classification.

This is not wrong, but the contract must be explicit.

### 7.1 OpenAPI Example

```yaml
paths:
  /cases/{caseId}/evidence:
    post:
      operationId: addCaseEvidence
      summary: Add evidence to a case
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required:
                - file
              properties:
                file:
                  type: string
                  format: binary
      responses:
        '201':
          description: Evidence resource created. Processing may continue asynchronously.
          headers:
            Location:
              schema:
                type: string
                format: uri-reference
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Evidence'
```

Schema:

```yaml
components:
  schemas:
    Evidence:
      type: object
      required:
        - evidenceId
        - caseId
        - status
        - createdAt
      properties:
        evidenceId:
          type: string
        caseId:
          type: string
        status:
          type: string
          enum:
            - pending_scan
            - scanning
            - pending_classification
            - available
            - quarantined
            - rejected
        createdAt:
          type: string
          format: date-time
        availableAt:
          type: string
          format: date-time
        rejectionReason:
          type: string
```

The key is not the status code itself. The key is semantic honesty.

If the evidence is not actually usable yet, expose that state.

---

## 8. Links Object

OpenAPI `links` let a response describe possible follow-up operations.

They are not full hypermedia controls in the strict REST maturity sense, but they are useful for documenting operation relationships.

### 8.1 Basic Link Example

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      responses:
        '201':
          description: Case created.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Case'
          links:
            GetCreatedCase:
              operationId: getCaseById
              parameters:
                caseId: '$response.body#/caseId'
              description: Retrieve the created case.

  /cases/{caseId}:
    get:
      operationId: getCaseById
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Case details.
```

The link says:

```text
After createCase returns 201, the consumer can call getCaseById using caseId from the response body.
```

### 8.2 Link by `operationRef`

You can also use `operationRef` instead of `operationId`.

```yaml
links:
  GetCreatedCase:
    operationRef: '#/paths/~1cases~1{caseId}/get'
    parameters:
      caseId: '$response.body#/caseId'
```

In practice, stable `operationId` is often easier to maintain for code generation and review.

### 8.3 When Links Are Valuable

Links are useful when:

- response values feed into follow-up operations,
- workflow transitions are not obvious,
- generated documentation should show possible next actions,
- consumer onboarding needs guidance,
- operation relationships matter for testing,
- API is process-oriented rather than pure CRUD.

### 8.4 Example: Workflow Transition Links

```yaml
responses:
  '200':
    description: Current case state.
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Case'
    links:
      AssignCase:
        operationId: assignCase
        parameters:
          caseId: '$response.body#/caseId'
        description: Assign the case if it is currently unassigned.
      EscalateCase:
        operationId: escalateCase
        parameters:
          caseId: '$response.body#/caseId'
        description: Escalate the case if escalation criteria are met.
      CloseCase:
        operationId: closeCase
        parameters:
          caseId: '$response.body#/caseId'
        description: Close the case if all required decisions are final.
```

Important caveat:

```text
OpenAPI links do not dynamically enforce whether the current user is allowed to call the linked operation.
```

They document relationships, not runtime authorization.

---

## 9. Hypermedia-Lite in OpenAPI

Strict hypermedia systems put links inside runtime representations.

Example response:

```json
{
  "caseId": "C-1001",
  "status": "under_review",
  "links": [
    {
      "rel": "self",
      "href": "/cases/C-1001"
    },
    {
      "rel": "submit-decision",
      "href": "/cases/C-1001/decision"
    },
    {
      "rel": "escalate",
      "href": "/cases/C-1001/escalations"
    }
  ]
}
```

OpenAPI can describe this representation with schemas, but it will not automatically infer all runtime link rules.

### 9.1 Schema Example

```yaml
components:
  schemas:
    Link:
      type: object
      required:
        - rel
        - href
      properties:
        rel:
          type: string
          example: self
        href:
          type: string
          format: uri-reference
        method:
          type: string
          enum: [GET, POST, PUT, PATCH, DELETE]

    Case:
      type: object
      required:
        - caseId
        - status
        - links
      properties:
        caseId:
          type: string
        status:
          type: string
        links:
          type: array
          items:
            $ref: '#/components/schemas/Link'
```

### 9.2 When Runtime Links Help

Runtime links help when:

- permissions are dynamic,
- states determine available transitions,
- consumers should not hard-code all possible transitions,
- workflows evolve,
- resource affordances matter,
- UI can be driven partly by allowed actions.

### 9.3 When Runtime Links Hurt

Runtime links can hurt when:

- clients require compile-time generated SDKs,
- operations need strong typing,
- link relation taxonomy is inconsistent,
- documentation does not explain transition semantics,
- links become an ungoverned string protocol.

A practical approach is often:

```text
Use OpenAPI operation definitions for strong contract.
Use response links for discoverability and workflow hints.
Use runtime links only when dynamic state/permission affordances are genuinely useful.
```

---

## 10. Modelling Long-Running Operations Properly

A long-running operation is not just a `status` string.

A good operation resource needs enough information for the consumer to make decisions.

### 10.1 Recommended Operation Resource Shape

```yaml
components:
  schemas:
    LongRunningOperation:
      type: object
      required:
        - operationId
        - kind
        - status
        - createdAt
        - updatedAt
        - links
      properties:
        operationId:
          type: string
        kind:
          type: string
          enum:
            - evidence_processing
            - case_export
            - bulk_case_assignment
            - decision_publication
        status:
          type: string
          enum:
            - accepted
            - queued
            - running
            - waiting_for_manual_review
            - completed
            - failed
            - cancelled
            - expired
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        expiresAt:
          type: string
          format: date-time
          description: When this operation status resource may no longer be available.
        idempotencyKey:
          type: string
          description: Idempotency key supplied by the client, if any.
        correlationId:
          type: string
          description: Correlation identifier for support and audit tracing.
        progress:
          $ref: '#/components/schemas/OperationProgress'
        result:
          $ref: '#/components/schemas/OperationResult'
        error:
          $ref: '#/components/schemas/Problem'
        links:
          type: array
          items:
            $ref: '#/components/schemas/Link'
```

### 10.2 Operation Progress

```yaml
    OperationProgress:
      type: object
      properties:
        percent:
          type: integer
          minimum: 0
          maximum: 100
        phase:
          type: string
          enum:
            - validating
            - scanning
            - extracting_text
            - indexing
            - waiting_for_reviewer
            - finalizing
        message:
          type: string
```

Progress is not always necessary. Be careful not to promise precision you cannot provide.

Bad progress model:

```json
{
  "percent": 73
}
```

If the backend does not really know progress and just guesses, consumers may build bad UX around fake certainty.

Better:

```json
{
  "phase": "extracting_text",
  "message": "Text extraction is in progress. Completion time depends on document size."
}
```

### 10.3 Terminal States

Every operation status model should identify terminal states.

Example:

```text
Terminal success:
  completed

Terminal failure:
  failed
  cancelled
  expired
```

Non-terminal:

```text
accepted
queued
running
waiting_for_manual_review
```

The contract should make clear whether clients should keep polling.

### 10.4 Result Modelling

There are two common result patterns.

#### Embedded Result

```json
{
  "operationId": "op_123",
  "status": "completed",
  "result": {
    "evidenceId": "EV-9001"
  }
}
```

Useful when result is small.

#### Linked Result

```json
{
  "operationId": "op_123",
  "status": "completed",
  "result": {
    "resourceType": "evidence",
    "resourceUrl": "/cases/C-1001/evidence/EV-9001"
  }
}
```

Useful when result is large, protected, or already has a canonical resource.

---

## 11. Polling Contract Design

Polling is easy to implement badly.

A good polling contract tells consumers:

- where to poll,
- how often to poll,
- when to stop,
- what errors mean,
- what status transitions are possible,
- how long status remains available.

### 11.1 Use `Retry-After`

For async acceptance:

```yaml
headers:
  Retry-After:
    description: Suggested minimum number of seconds before polling this operation.
    schema:
      type: integer
      minimum: 1
```

For rate limiting:

```yaml
responses:
  '429':
    description: Too many polling requests.
    headers:
      Retry-After:
        schema:
          type: integer
          minimum: 1
```

### 11.2 Document Polling Behaviour

Example operation description:

```yaml
summary: Get operation status
description: |
  Returns the current status of a long-running operation.

  Clients should stop polling when status is one of:
  - completed
  - failed
  - cancelled
  - expired

  Clients should respect Retry-After when present and should use exponential
  backoff if repeated 429 responses are received.
```

### 11.3 Polling Anti-Patterns

Bad:

```text
POST returns 202 but no status URL.
```

Bad:

```text
Status endpoint returns only true/false.
```

Bad:

```text
Status values are undocumented strings.
```

Bad:

```text
Clients are told to poll every second forever.
```

Bad:

```text
Operation disappears immediately after completion.
```

Bad:

```text
Failure reason only appears in server logs.
```

---

## 12. Idempotency in Async Operations

Async operations almost always need idempotency.

Why?

Because the dangerous moment is this:

```text
Client sends request.
Server accepts and enqueues operation.
Network fails before client receives 202 response.
Client does not know whether operation exists.
```

Without idempotency, retry may create duplicate work.

### 12.1 Idempotency Key Header

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: false
    schema:
      type: string
      minLength: 1
      maxLength: 255
    description: |
      Client-generated key used to safely retry operation creation.
      Reusing the same key with the same request returns the original operation.
```

### 12.2 Response Reuse

If the client retries with the same idempotency key, the server should return the same operation if the original request was accepted.

Possible response:

```text
202 Accepted
Location: /operations/op_123
```

### 12.3 Idempotency Conflict

If the same key is reused with a different request body:

```yaml
'409':
  description: Idempotency key was already used with a different request.
  content:
    application/problem+json:
      schema:
        $ref: '#/components/schemas/Problem'
```

### 12.4 Java Implementation Note

In Java service architecture, idempotency usually belongs near the application boundary, not deep inside domain logic.

Typical layers:

```text
Controller
  -> validates request shape
  -> extracts idempotency key
  -> calls application service

Application service
  -> checks idempotency record
  -> persists command/operation atomically
  -> enqueues work
  -> returns existing or new operation

Worker
  -> processes operation idempotently
  -> updates operation status
```

Do not rely on OpenAPI alone. OpenAPI documents the contract; database uniqueness and transaction boundaries enforce it.

---

## 13. Correlation and Traceability

Async APIs need correlation because there is no single request-response span covering the whole business process.

### 13.1 Correlation ID Header

```yaml
parameters:
  - name: X-Correlation-Id
    in: header
    required: false
    schema:
      type: string
    description: Client-supplied correlation ID used for tracing and support.
```

### 13.2 Operation-Level Correlation

```yaml
properties:
  correlationId:
    type: string
    description: Correlates the original request, background processing, callbacks, and audit records.
```

### 13.3 Why It Matters

For support and audit, you often need to answer:

```text
Which HTTP request started this operation?
Which worker processed it?
Which callback attempt failed?
Which user initiated it?
Which case did it affect?
Which release version handled it?
Which downstream service rejected it?
```

OpenAPI can document correlation fields and headers. Observability systems must make them real.

---

## 14. Modelling Callbacks Safely

A callback payload should include enough metadata for safe processing.

### 14.1 Recommended Callback Envelope

```yaml
components:
  schemas:
    CallbackEnvelope:
      type: object
      required:
        - callbackId
        - operationId
        - eventType
        - occurredAt
        - deliveredAt
        - data
      properties:
        callbackId:
          type: string
          description: Unique identifier for this callback delivery event.
        operationId:
          type: string
        eventType:
          type: string
        occurredAt:
          type: string
          format: date-time
          description: Time the business event occurred.
        deliveredAt:
          type: string
          format: date-time
          description: Time this callback was sent.
        data:
          type: object
        signature:
          type: string
          description: Optional payload signature, if signature is carried in body instead of header.
```

Many systems put signature in headers instead:

```yaml
parameters:
  - name: X-Signature
    in: header
    required: true
    schema:
      type: string
  - name: X-Signature-Timestamp
    in: header
    required: true
    schema:
      type: string
```

### 14.2 Duplicate Delivery

Webhook/callback consumers should assume at-least-once delivery unless the provider explicitly guarantees otherwise.

Document this:

```yaml
description: |
  Callback delivery is at-least-once. Consumers must process callbackId
  idempotently and tolerate duplicate deliveries.
```

### 14.3 Ordering

Do not imply ordering unless you actually guarantee it.

Bad:

```text
Events are sent in order.
```

Better:

```text
Events for the same operation are usually delivered in occurrence order, but consumers must tolerate duplicate and out-of-order delivery. Use occurredAt and operation status lookup for reconciliation.
```

If strict ordering is required, the system design must support it explicitly.

---

## 15. OpenAPI vs AsyncAPI

OpenAPI is primarily for describing HTTP APIs.

AsyncAPI is designed for event-driven and message-based APIs.

### 15.1 Use OpenAPI When

Use OpenAPI when the interaction is mainly:

- HTTP request-response,
- HTTP polling,
- HTTP callback,
- HTTP webhook,
- REST-like resource access,
- HTTP-based command submission.

### 15.2 Use AsyncAPI When

Use AsyncAPI when the interaction is mainly:

- Kafka topics,
- RabbitMQ exchanges/queues,
- MQTT topics,
- message channels,
- pub/sub events,
- event schemas,
- producer/consumer roles,
- durable streams,
- event-driven architecture.

### 15.3 Use Both When

Many production systems need both.

Example:

```text
OpenAPI:
  POST /case-exports
  GET /operations/{operationId}
  POST /webhook-subscriptions

AsyncAPI:
  case.export.completed event on Kafka
  case.escalated event on regulatory-events topic
```

OpenAPI describes the HTTP control plane.
AsyncAPI describes the event/message plane.

Do not force OpenAPI to model a Kafka ecosystem. It will become awkward and imprecise.

---

## 16. Case Workflow Modelling Example

Imagine a regulatory case management API.

States:

```text
draft -> submitted -> triaged -> assigned -> under_investigation
      -> pending_decision -> decision_issued -> closed
      -> appealed -> appeal_decided -> closed
```

Some transitions are synchronous:

```text
GET /cases/{caseId}
```

Some transitions are command-like:

```text
POST /cases/{caseId}/submit
POST /cases/{caseId}/assignments
POST /cases/{caseId}/escalations
POST /cases/{caseId}/decisions
POST /cases/{caseId}/appeals
```

Some work is async:

```text
POST /cases/{caseId}/evidence-packages
POST /cases/{caseId}/public-disclosure-review
POST /case-exports
```

Some notifications are webhook-like:

```text
case.assigned
case.escalated
evidence.processing_failed
decision.issued
appeal.submitted
case.closed
```

A weak API contract only lists endpoints.

A strong API contract models the lifecycle:

- states,
- transitions,
- allowed actions,
- operation status,
- links,
- callbacks/webhooks,
- failure modes,
- audit IDs,
- correlation IDs,
- permission constraints,
- deprecation behaviour.

---

## 17. Example: Escalation Operation with Link and Webhook

### 17.1 Escalate Case

```yaml
paths:
  /cases/{caseId}/escalations:
    post:
      operationId: escalateCase
      summary: Escalate a case for higher-priority review
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EscalateCaseRequest'
      responses:
        '202':
          description: Escalation accepted and queued for review.
          headers:
            Location:
              schema:
                type: string
                format: uri-reference
            Retry-After:
              schema:
                type: integer
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OperationAcceptedResponse'
          links:
            GetEscalationOperation:
              operationId: getOperationStatus
              parameters:
                operationId: '$response.body#/operationId'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          $ref: '#/components/responses/Conflict'
```

### 17.2 Webhook Event

```yaml
webhooks:
  caseEscalationCompleted:
    post:
      operationId: receiveCaseEscalationCompletedWebhook
      summary: Webhook delivered when case escalation reaches a terminal outcome
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CaseEscalationCompletedEvent'
      responses:
        '204':
          description: Event accepted.
```

### 17.3 Event Schema

```yaml
components:
  schemas:
    CaseEscalationCompletedEvent:
      type: object
      required:
        - eventId
        - eventType
        - occurredAt
        - data
      properties:
        eventId:
          type: string
        eventType:
          type: string
          const: case.escalation.completed
        occurredAt:
          type: string
          format: date-time
        data:
          type: object
          required:
            - caseId
            - escalationId
            - outcome
          properties:
            caseId:
              type: string
            escalationId:
              type: string
            outcome:
              type: string
              enum:
                - approved
                - rejected
                - requires_more_information
            operationId:
              type: string
```

---

## 18. Runtime Expressions Deep Dive

Runtime expressions let links and callbacks extract data from actual request/response values.

Common examples:

```yaml
$response.body#/id
$request.body#/callbackUrl
$request.path.caseId
$request.query.filter
$request.header.X-Correlation-Id
```

### 18.1 Use in Links

```yaml
links:
  GetCase:
    operationId: getCaseById
    parameters:
      caseId: '$response.body#/caseId'
```

### 18.2 Use in Callbacks

```yaml
callbacks:
  completion:
    '{$request.body#/callbackUrl}':
      post:
        requestBody:
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CompletionCallback'
        responses:
          '204':
            description: Callback accepted.
```

### 18.3 Practical Advice

Runtime expressions are powerful but can reduce readability.

Use them where they clarify operation relationships. Avoid making the OpenAPI document look like a programming language.

Good:

```text
Link created resource to get resource operation.
```

Risky:

```text
Complex callback URL construction based on multiple fields and string conventions.
```

---

## 19. State Transitions and OpenAPI

OpenAPI can describe transition operations, but it does not fully model state machines.

Example transition endpoints:

```text
POST /cases/{caseId}/submit
POST /cases/{caseId}/assignments
POST /cases/{caseId}/escalations
POST /cases/{caseId}/decisions
POST /cases/{caseId}/closure
```

Each operation should document:

- required current state,
- resulting state or possible resulting states,
- permission requirement,
- idempotency behaviour,
- conflict behaviour,
- audit output,
- async or sync completion,
- webhook events emitted.

### 19.1 Example Description

```yaml
summary: Submit a draft case
description: |
  Submits a draft case for triage.

  Preconditions:
  - Case status must be draft.
  - Required complainant and allegation fields must be complete.
  - Caller must have case.submit permission.

  On success:
  - Case status changes to submitted.
  - A case.submitted event may be emitted.

  Conflict:
  - Returns 409 if the case is not in draft status.
```

This narrative matters.

A schema alone cannot express all lifecycle invariants.

---

## 20. Choosing Between Polling, Callback, Webhook, and Event Stream

Use this decision model.

### 20.1 Polling

Choose polling when:

- consumer can tolerate delay,
- number of consumers is manageable,
- operation status is important,
- callback delivery would add unnecessary complexity,
- external inbound access to consumer is difficult.

Trade-off:

```text
Simple and robust, but can create unnecessary load if abused.
```

### 20.2 Callback

Choose callback when:

- operation-specific completion notification is important,
- consumer can expose a secure endpoint,
- provider can safely call consumer endpoints,
- delivery semantics are well understood.

Trade-off:

```text
Convenient for consumers, but security and delivery complexity increase.
```

### 20.3 Webhook

Choose webhook when:

- consumers subscribe to business events,
- many events are relevant beyond one operation,
- event notification is a first-class integration feature.

Trade-off:

```text
Good for integration, but needs strong event governance and duplicate handling.
```

### 20.4 Event Stream / Message Broker

Choose event stream when:

- event volume is high,
- consumers are internal or trusted,
- ordering/partitioning/replay matters,
- durable event processing is needed,
- Kafka/RabbitMQ/PubSub is already the right integration plane.

Trade-off:

```text
Powerful, but should be modelled with AsyncAPI or event-specific contracts rather than forcing everything into OpenAPI.
```

---

## 21. Java/Spring Implementation Mapping

### 21.1 Controller for Async Command

```java
@RestController
@RequestMapping("/cases/{caseId}/evidence-packages")
class EvidencePackageController {

    private final SubmitEvidencePackageUseCase useCase;

    @PostMapping
    ResponseEntity<OperationAcceptedResponse> submit(
            @PathVariable String caseId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestHeader(name = "X-Correlation-Id", required = false) String correlationId,
            @Valid @RequestBody SubmitEvidencePackageRequest request
    ) {
        OperationAcceptedResponse response = useCase.submit(
                caseId,
                idempotencyKey,
                correlationId,
                request
        );

        return ResponseEntity
                .accepted()
                .location(URI.create(response.statusUrl()))
                .header("Retry-After", "10")
                .body(response);
    }
}
```

### 21.2 Operation Status Controller

```java
@RestController
@RequestMapping("/operations")
class OperationController {

    private final OperationQueryService queryService;

    @GetMapping("/{operationId}")
    OperationStatus getStatus(@PathVariable String operationId) {
        return queryService.getOperationStatus(operationId);
    }
}
```

### 21.3 Worker Boundary

```java
class EvidencePackageWorker {

    void process(String operationId) {
        Operation op = operationRepository.getForProcessing(operationId);

        try {
            operationRepository.markRunning(operationId);
            EvidenceResult result = evidenceProcessor.process(op.payload());
            operationRepository.markCompleted(operationId, result);
        } catch (RecoverableException ex) {
            operationRepository.markRetryableFailure(operationId, ex);
            throw ex;
        } catch (Exception ex) {
            operationRepository.markFailed(operationId, ex);
        }
    }
}
```

### 21.4 Architecture Rule

Do not let HTTP controller threads perform long-running work just because the OpenAPI operation is `POST`.

Better:

```text
POST validates, authorizes, persists operation, enqueues work, returns 202.
Worker performs processing.
GET status observes durable operation state.
```

---

## 22. Common Failure Modes

### 22.1 Fake Synchronous Completion

```text
API returns 200 OK, but work continues in background.
```

Consumer assumes work is done.

Fix:

```text
Return 202 or expose explicit pending state.
```

### 22.2 Missing Operation Resource

```text
API returns 202 but gives no operation ID or status URL.
```

Consumer cannot reconcile.

Fix:

```text
Return operationId and Location header.
```

### 22.3 Undocumented Terminal Failure

```text
Operation can fail after acceptance, but OpenAPI only documents 202.
```

Consumer cannot handle business failure.

Fix:

```text
Document operation status schema with error details.
```

### 22.4 Callback Without Idempotency

```text
Provider retries callback, consumer processes event twice.
```

Fix:

```text
Include eventId/callbackId and document at-least-once delivery.
```

### 22.5 Callback Without Signature

```text
Anyone can fake provider callbacks.
```

Fix:

```text
Use authentication/signature scheme and document required headers.
```

### 22.6 Polling Storm

```text
Thousands of clients poll every second.
```

Fix:

```text
Use Retry-After, backoff guidance, 429, and webhook option if needed.
```

### 22.7 State Machine Hidden in Descriptions Only

```text
Schema says status is string. Description says many rules. No enum, no transition operations, no conflict responses.
```

Fix:

```text
Use explicit status enum, transition operations, 409 conflicts, and examples.
```

### 22.8 Event Schema Drift

```text
Webhook payload changes independently from OpenAPI.
```

Fix:

```text
Version event payloads, validate examples, and publish webhook contract as release artifact.
```

---

## 23. Review Checklist for Async OpenAPI Design

Use this checklist when reviewing an async OpenAPI contract.

### 23.1 Initial Operation

- Does response status honestly reflect business completion?
- Should this be `201`, `200`, or `202`?
- Is operation creation idempotent?
- Is `Location` returned?
- Is `Retry-After` returned or documented?
- Are failure responses documented?
- Are authorization failures distinct from state conflicts?

### 23.2 Operation Resource

- Is there a durable operation ID?
- Are status values explicit?
- Are terminal states clear?
- Is failure detail represented?
- Is result represented or linked?
- Is retention/expiry described?
- Is cancellation supported or explicitly unsupported?

### 23.3 Polling

- Is polling endpoint documented?
- Are backoff expectations documented?
- Is 429 documented?
- Can client recover if initial response was lost?

### 23.4 Callback/Webhook

- Is delivery at-least-once or exactly-once? If not exactly guaranteed, say so.
- Is duplicate handling documented?
- Is event ID present?
- Is signature/auth documented?
- Are retry rules documented?
- Are timeout rules documented?
- Is ordering guaranteed? If not, say so.
- Is replay supported?

### 23.5 Links and Workflow

- Are follow-up operations discoverable?
- Are `operationId`s stable?
- Do links use clear runtime expressions?
- Are state transition preconditions documented?
- Are conflict responses documented?

### 23.6 Java Implementation

- Is long-running work offloaded from controller thread?
- Is operation persistence atomic with enqueueing or otherwise reliable?
- Is idempotency enforced by durable storage?
- Are operation status updates transactional enough?
- Are callbacks retried safely?
- Are duplicate events tolerated?

---

## 24. Practical Design Heuristics

### 24.1 Prefer Explicit Lifecycle Resources

If the operation matters, give it a resource.

```text
Good:
  /operations/{operationId}
  /exports/{exportId}
  /evidence-processing-jobs/{jobId}

Weak:
  "Come back later and check the case."
```

### 24.2 Prefer Business-Specific Resources When They Are Stable

Generic operation resources are useful, but sometimes a business-specific job resource is clearer.

```text
/case-exports/{exportId}
/evidence-packages/{packageId}/processing-status
/bulk-assignments/{assignmentBatchId}
```

Use generic `/operations` when many operation types share lifecycle infrastructure.

Use specific resources when the operation itself is meaningful domain concept.

### 24.3 Do Not Overuse Callbacks

Callbacks look elegant on diagrams but create operational burden.

Ask:

```text
Can polling solve this safely?
Is the consumer able to expose a secure public endpoint?
Do we have retry and signature infrastructure?
Do we have delivery audit?
What happens if the callback fails for 3 days?
```

### 24.4 Model Failure as First-Class

An async operation can fail after `202`.

That failure must be contract-visible.

### 24.5 Do Not Hide Human Review

If the process can wait for manual review, model it.

```yaml
status:
  enum:
    - running
    - waiting_for_manual_review
    - completed
    - failed
```

This is especially important in regulated systems.

### 24.6 Be Honest About Ordering

Unless you have a strict ordering mechanism, document that consumers must tolerate out-of-order delivery.

### 24.7 Every Async API Needs Reconciliation

Callbacks fail. Webhooks duplicate. Polling clients crash. Networks partition.

The contract should provide a way to ask:

```text
What is the current truth?
```

That usually means a GET endpoint.

---

## 25. Mini Case Study: Public Disclosure Review

A regulatory agency has an endpoint to request public disclosure review for a case document.

The process includes:

1. accept request,
2. validate document eligibility,
3. run automated sensitive data scan,
4. send to human reviewer if risk is high,
5. produce redacted document,
6. notify requesting system.

### 25.1 Weak Design

```text
POST /documents/{documentId}/redact
200 OK
```

Problem:

- Does `200` mean redaction is complete?
- Where is the redacted document?
- What if human review is needed?
- What if request is rejected later?
- How does caller know when to download?
- How does caller correlate support issues?

### 25.2 Stronger Design

```text
POST /documents/{documentId}/public-disclosure-reviews
202 Accepted
Location: /operations/op_123

GET /operations/op_123
200 OK
{
  "operationId": "op_123",
  "kind": "public_disclosure_review",
  "status": "waiting_for_manual_review",
  "correlationId": "corr_abc",
  "links": [
    { "rel": "self", "href": "/operations/op_123" },
    { "rel": "document", "href": "/documents/D-1001" }
  ]
}
```

Completion:

```json
{
  "operationId": "op_123",
  "kind": "public_disclosure_review",
  "status": "completed",
  "result": {
    "redactedDocumentUrl": "/documents/D-1001/redacted-versions/R-9001"
  }
}
```

Optional webhook:

```text
public_disclosure_review.completed
public_disclosure_review.failed
```

This design tells the truth about the lifecycle.

---

## 26. What Top 1% Engineers Do Differently

Average OpenAPI usage:

```text
Document endpoint inputs and outputs.
```

Strong OpenAPI usage:

```text
Document interaction lifecycle.
```

Top-tier engineers ask:

- What does this response actually guarantee?
- Can the business process fail after the response?
- How will the consumer know final state?
- Can the consumer retry safely?
- Can the consumer reconcile after network failure?
- Are duplicate notifications safe?
- Are states and transitions explicit?
- Does the OpenAPI document expose enough for generated clients and human workflows?
- Are security assumptions visible?
- Are async failures part of the contract, not implementation trivia?

They model API contracts as living interaction systems, not endpoint inventories.

---

## 27. Key Takeaways

1. Not every API interaction ends when the HTTP response is returned.
2. `202 Accepted` should usually return a durable operation resource or status URL.
3. Polling is simple and robust when designed with `Retry-After`, terminal states, and clear failure details.
4. Callbacks and webhooks are powerful but require idempotency, signatures, retry semantics, duplicate handling, and reconciliation.
5. OpenAPI `links` can document follow-up operations and workflow affordances.
6. Runtime expressions connect response/request values to links and callbacks.
7. OpenAPI can describe HTTP callbacks and webhooks, but message/event systems often need AsyncAPI.
8. Long-running operation resources should expose status, result, error, correlation, and terminal states.
9. Regulated and workflow-heavy systems should make states, transitions, and audit traceability explicit.
10. The best OpenAPI contracts model interaction truth, not just DTO shapes.

---

## 28. Practice Exercises

### Exercise 1 — Convert Fake Sync to Async

Given this operation:

```text
POST /case-exports
200 OK
```

Design a better OpenAPI contract where export generation is async.

Include:

- `202 Accepted`,
- `Location`,
- operation status schema,
- terminal states,
- download link when complete,
- failure response,
- idempotency key.

### Exercise 2 — Design Callback Contract

Design an operation:

```text
POST /identity-verification-jobs
```

The caller supplies a callback URL. The provider calls back when verification completes.

Document:

- request body,
- callback URL,
- callback payload,
- callback response,
- event ID,
- signature headers,
- duplicate delivery semantics.

### Exercise 3 — Model Case Workflow Links

Given a `Case` response, add OpenAPI links for:

- assign case,
- escalate case,
- submit decision,
- close case.

Use `$response.body#/caseId` to supply path parameters.

### Exercise 4 — Webhook Event Design

Design top-level webhooks for:

- `case.assigned`,
- `case.escalated`,
- `decision.issued`,
- `case.closed`.

Create a common event envelope and event-specific data schemas.

### Exercise 5 — Failure Mode Review

Review an existing async API in your organization or project.

Ask:

- Can clients retry safely?
- Is the final state observable?
- Are duplicate callbacks possible?
- Are terminal failure states visible?
- Is there a reconciliation endpoint?
- Does the OpenAPI contract document all of this?

---

## 29. Suggested Next Reading and Tooling Areas

For deeper mastery after this part, study:

- OpenAPI `Link Object`, `Callback Object`, `Webhook Object`, and runtime expressions.
- HTTP `202 Accepted`, `Location`, `Retry-After`, and `429 Too Many Requests` semantics.
- Idempotency key patterns.
- Webhook security patterns.
- AsyncAPI for event-driven contracts.
- Long-running operation patterns in cloud APIs.
- Saga/process manager patterns.
- Workflow engines and state machines.
- Outbox pattern for reliable event/callback delivery.
- Dead-letter queues and retry policies.
- API reconciliation endpoints.

---

## 30. Series Progress

```text
Current part: 019 / 030
Status: In progress
Series complete: No
Remaining parts: 11
Next: Part 020 — Governance: Style Guides, Linting, Review, Standards, and API Portfolio Control
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-018.md">⬅️ OpenAPI Mastery for Java Engineers — Part 018</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-020.md">OpenAPI Mastery for Java Engineers — Part 020 ➡️</a>
</div>
