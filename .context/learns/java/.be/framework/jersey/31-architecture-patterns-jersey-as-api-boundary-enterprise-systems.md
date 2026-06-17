# Part 31 — Architecture Patterns: Jersey as API Boundary in Enterprise Systems

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Previous: Part 30 — Production Failure Modes: Debugging Real Jersey Incidents  
Next: Part 32 — Capstone: Building a Production-Grade Jersey Platform Module

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita banyak membahas Jersey dari sisi runtime: resource model, matching, provider, filter, exception mapper, client, async, observability, performance, deployment, configuration, testing, extension, migration, dan debugging incident.

Part ini naik satu level:

> Bagaimana menempatkan Jersey sebagai **API boundary** dalam sistem enterprise, bukan sekadar framework endpoint.

Di production enterprise, terutama sistem case management, regulatory workflow, enforcement lifecycle, approval, document handling, appeal, compliance, investigation, dan audit-heavy systems, endpoint bukan hanya pintu masuk HTTP. Endpoint adalah titik legal/operasional tempat sistem menerima niat pengguna, membuktikan otoritas, memvalidasi input, memulai perubahan state, mencatat evidence, dan mengembalikan kontrak yang bisa dipertahankan.

Jersey membantu di boundary itu karena Jakarta REST mendefinisikan resource, provider, filter, context, exception mapping, client API, dan extension model. Jakarta REST adalah specification untuk membangun RESTful web services di Java, sementara Jersey adalah implementation/runtime yang menjalankan kontrak itu. Referensi resmi Jakarta REST 4.0 dan Jersey documentation harus selalu dibedakan: spec menjelaskan contract; Jersey menjelaskan behavior implementation dan extension points. [Jakarta REST 4.0](https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0), [Jersey User Guide](https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/index.html)

---

## 1. Mental Model: Jersey Resource Is an Adapter, Not the Application

Kesalahan paling umum adalah menjadikan resource class sebagai “aplikasi”.

Contoh buruk:

```java
@Path("/cases")
public class CaseResource {

    @POST
    public Response createCase(CreateCaseRequest request) {
        // validate fields
        // check role
        // call repository
        // create audit trail
        // send email
        // update workflow
        // build response
        // catch all exceptions
        // log everything
    }
}
```

Kode seperti ini mungkin bekerja, tetapi boundary-nya kabur. Resource berubah menjadi campuran:

- HTTP adapter
- validation layer
- authorization layer
- transaction coordinator
- domain service
- repository user
- audit writer
- notification dispatcher
- error mapper
- response mapper

Untuk sistem kecil ini terlihat cepat. Untuk sistem besar, ini membuat endpoint sulit dites, sulit diamankan, sulit dimigrasi, sulit diobservasi, dan sulit dipertanggungjawabkan.

Model yang lebih sehat:

```text
HTTP Request
  ↓
Jersey Resource / Filter / Provider / Mapper
  ↓
Application Command / Query Boundary
  ↓
Domain / Workflow / Policy Service
  ↓
Persistence / External System / Messaging
  ↓
Application Result
  ↓
Jersey Response Mapper
  ↓
HTTP Response
```

Resource Jersey seharusnya menjadi **adapter**:

```text
External HTTP Contract → Internal Application Contract
```

Bukan:

```text
External HTTP Contract → Everything
```

### 1.1 Tanggung Jawab Resource yang Ideal

Resource bertanggung jawab untuk:

1. menerima input HTTP;
2. mengikat path/query/header/body ke DTO;
3. mengambil context HTTP/security/correlation;
4. menerjemahkan request menjadi command/query internal;
5. memanggil application service;
6. menerjemahkan result menjadi response HTTP;
7. membiarkan exception mapper menangani failure contract.

Resource tidak ideal jika memegang:

- SQL detail;
- workflow transition rule kompleks;
- authorization object-level detail yang tersebar;
- audit persistence detail;
- retry outbound service;
- formatting error response manual;
- transaction multi-step tanpa application service.

---

## 2. Boundary Layer dalam Enterprise API

Dalam enterprise architecture, boundary yang sehat biasanya dipisah menjadi beberapa lapisan konseptual.

```text
┌──────────────────────────────────────────────────────────┐
│ HTTP Boundary                                             │
│ Jersey Resource, Filter, Provider, ExceptionMapper         │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ Application Boundary                                      │
│ Command Handler, Query Handler, Use Case Service           │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ Domain / Policy / Workflow Layer                          │
│ Rules, State Machine, Invariants, Authorization Policy     │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ Infrastructure Layer                                      │
│ Repository, External Client, Messaging, File Store, Audit  │
└──────────────────────────────────────────────────────────┘
```

Jersey berada terutama di HTTP boundary. Namun filter, security context, exception mapper, client, and provider dapat mendukung boundary lain. Yang penting: **ownership tetap jelas**.

### 2.1 HTTP Boundary

HTTP boundary menjawab pertanyaan:

- Apa URI-nya?
- Apa method-nya?
- Apa request body-nya?
- Apa response status-nya?
- Apa header-nya?
- Apa error shape-nya?
- Bagaimana auth identity masuk?
- Bagaimana request dilacak?

### 2.2 Application Boundary

Application boundary menjawab:

- Use case apa yang diminta?
- Command/query apa yang dijalankan?
- Apa precondition bisnisnya?
- Apa transaction boundary-nya?
- Apa event/audit yang harus muncul?
- Apa result internalnya?

### 2.3 Domain / Policy Boundary

Domain/policy boundary menjawab:

- State transition apa yang valid?
- Role/authority apa yang boleh melakukan aksi?
- Apa invariant yang tidak boleh dilanggar?
- Apa aturan escalation?
- Apa konsekuensi cross-entity?

### 2.4 Infrastructure Boundary

Infrastructure boundary menjawab:

- Bagaimana data disimpan?
- Bagaimana external API dipanggil?
- Bagaimana retry/timeout dilakukan?
- Bagaimana file disimpan?
- Bagaimana audit event dipersist?
- Bagaimana message diterbitkan?

---

## 3. Hexagonal Architecture dengan Jersey

Hexagonal architecture atau ports-and-adapters cocok untuk Jersey.

```text
             ┌──────────────────────────────┐
HTTP Client →│ Jersey Resource Adapter       │
             └──────────────┬───────────────┘
                            ↓
             ┌──────────────────────────────┐
             │ Application Port             │
             │ CreateCaseUseCase            │
             │ ApproveCaseUseCase           │
             │ SearchCaseQuery              │
             └──────────────┬───────────────┘
                            ↓
             ┌──────────────────────────────┐
             │ Domain Model / Policies      │
             └──────────────┬───────────────┘
                            ↓
             ┌──────────────────────────────┐
             │ Outbound Ports               │
             │ CaseRepository               │
             │ AuditPublisher               │
             │ NotificationGateway          │
             │ DocumentStore                │
             └──────────────────────────────┘
```

Resource Jersey adalah inbound adapter. Jersey Client bisa menjadi outbound adapter, tetapi sebaiknya dibungkus dalam gateway abstraction.

### 3.1 Inbound Port Pattern

```java
public interface SubmitCaseUseCase {
    SubmitCaseResult submit(SubmitCaseCommand command);
}
```

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final SubmitCaseUseCase submitCaseUseCase;

    public CaseResource(SubmitCaseUseCase submitCaseUseCase) {
        this.submitCaseUseCase = submitCaseUseCase;
    }

    @POST
    public Response submit(
            @Valid SubmitCaseRequest request,
            @Context SecurityContext securityContext,
            @Context UriInfo uriInfo) {

        Actor actor = Actor.from(securityContext);

        SubmitCaseCommand command = SubmitCaseCommand.from(request, actor);
        SubmitCaseResult result = submitCaseUseCase.submit(command);

        URI location = uriInfo.getAbsolutePathBuilder()
                .path(result.caseId().value())
                .build();

        return Response.created(location)
                .entity(SubmitCaseResponse.from(result))
                .build();
    }
}
```

Resource melakukan mapping. Use case melakukan orkestrasi. Domain service menjaga invariant. Repository hanya persistence.

### 3.2 Outbound Port Pattern dengan Jersey Client

Jangan sebarkan `Client` dan `WebTarget` ke seluruh domain/application layer.

Kurang baik:

```java
public class ApprovalService {
    private final Client client;

    public void approve(...) {
        Response response = client.target(url)
                .path("/external")
                .request()
                .post(Entity.json(payload));
    }
}
```

Lebih baik:

```java
public interface IdentityVerificationGateway {
    VerificationResult verify(IdentityVerificationRequest request);
}
```

```java
public class JerseyIdentityVerificationGateway implements IdentityVerificationGateway {

    private final WebTarget target;

    public VerificationResult verify(IdentityVerificationRequest request) {
        try (Response response = target.path("/verify")
                .request(MediaType.APPLICATION_JSON_TYPE)
                .post(Entity.json(request))) {

            if (response.getStatus() == 200) {
                return response.readEntity(VerificationResult.class);
            }

            throw RemoteSystemException.from(response);
        }
    }
}
```

Dengan pola ini, Jersey Client adalah detail infrastructure, bukan API internal domain.

---

## 4. Resource as Controller Boundary, Not Business Object

Resource class bukan domain object. Resource class adalah controller boundary.

### 4.1 Rule of Thumb

Sebuah method resource sehat biasanya punya bentuk:

```text
extract context
  → map request to command/query
  → call application service
  → map result to response
```

Jika method resource berisi banyak `if` bisnis, kemungkinan boundary sudah bocor.

### 4.2 Contoh Command Endpoint

```java
@POST
@Path("/{caseId}/actions/approve")
public Response approve(
        @PathParam("caseId") String caseId,
        @Valid ApproveCaseRequest request,
        @Context SecurityContext securityContext) {

    ApproveCaseCommand command = new ApproveCaseCommand(
            CaseId.parse(caseId),
            request.decisionNote(),
            Actor.from(securityContext)
    );

    ApproveCaseResult result = approveCaseUseCase.approve(command);

    return Response.ok(ApproveCaseResponse.from(result)).build();
}
```

Resource tidak perlu tahu detail:

- apakah state `SUBMITTED` boleh menjadi `APPROVED`;
- apakah actor punya delegation;
- apakah SLA counter harus berhenti;
- apakah audit event perlu `APPROVAL_DECISION_RECORDED`;
- apakah notification harus dikirim;
- apakah case summary denormalized view harus diupdate.

Itu urusan use case/domain layer.

---

## 5. DTO Mapping Boundary

DTO bukan entity persistence dan bukan domain model.

### 5.1 Kenapa DTO Boundary Penting

Jika entity persistence langsung dipakai sebagai request/response:

- field internal bisa bocor;
- lazy proxy bisa gagal serialize;
- perubahan DB schema menjadi breaking API change;
- authorization per field sulit;
- API versioning sulit;
- cyclic object graph bisa menghasilkan infinite recursion;
- audit reasoning kabur: input user tidak eksplisit.

DTO boundary harus eksplisit:

```text
HTTP JSON DTO ↔ Application Command/Query ↔ Domain Model ↔ Persistence Entity
```

### 5.2 Request DTO

Request DTO harus mencerminkan kontrak input client, bukan bentuk database.

```java
public record SubmitCaseRequest(
        @NotBlank String applicantId,
        @NotBlank String categoryCode,
        @NotBlank String description,
        List<DocumentReferenceRequest> documents
) {}
```

### 5.3 Command Object

Command object membawa niat aplikasi.

```java
public record SubmitCaseCommand(
        ApplicantId applicantId,
        CaseCategory category,
        String description,
        List<DocumentReference> documents,
        Actor submittedBy,
        Instant submittedAt
) {}
```

Perbedaan penting:

- DTO menerima string karena datang dari HTTP.
- Command memakai value object karena sudah melewati parsing awal.
- Domain layer tidak perlu tahu `@QueryParam`, `@PathParam`, atau JSON field name.

### 5.4 Response DTO

Response DTO adalah public view.

```java
public record CaseDetailResponse(
        String caseId,
        String status,
        String submittedAt,
        String assignedOfficer,
        List<LinkResponse> links
) {}
```

Response harus dikurasi. Jangan mengembalikan semua yang tersedia secara internal.

---

## 6. Transaction Boundary

Jersey resource sebaiknya tidak menjadi tempat transaction detail kompleks.

Ada tiga pola umum.

### 6.1 Transaction per Use Case

```text
Resource method
  → useCase.execute(command)
      → transaction begins
      → load aggregate
      → validate invariant
      → mutate state
      → persist
      → write audit/outbox
      → transaction commits
  → response
```

Ini pola paling umum dan mudah dipertanggungjawabkan.

### 6.2 Transaction in Service Layer

Resource memanggil service yang ditandai transactional, misalnya CDI/Spring/Jakarta Transaction.

```java
public class SubmitCaseService implements SubmitCaseUseCase {

    @Transactional
    public SubmitCaseResult submit(SubmitCaseCommand command) {
        // atomic use case
    }
}
```

Resource tidak memulai transaction manual.

### 6.3 No Transaction in Resource

Hindari:

```java
@POST
public Response submit(Request request) {
    transaction.begin();
    try {
        ...
        transaction.commit();
    } catch (Exception e) {
        transaction.rollback();
        return Response.serverError().build();
    }
}
```

Masalah:

- error mapping bypassed;
- transaction concern bercampur dengan HTTP;
- sulit dites;
- audit/outbox konsistensi mudah salah;
- resource menjadi procedural script.

### 6.4 Transaction and External Calls

Jangan tahan DB transaction saat memanggil dependency lambat.

Buruk:

```text
begin transaction
  update case
  call external payment API   ← transaction terbuka saat network call
  update result
commit
```

Lebih sehat:

```text
begin transaction
  record intent
  persist outbox message
commit

worker reads outbox
  call external API with timeout/retry/idempotency
  record external result
```

Untuk Jersey endpoint, ini sering berarti response `202 Accepted`, bukan selalu `200 OK` atau `201 Created`. HTTP semantics, termasuk `202 Accepted`, status code, dan idempotent method, didefinisikan oleh RFC 9110. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)

---

## 7. Authorization Boundary

Authorization tidak boleh hanya berhenti di route-level role check.

### 7.1 Layer Authorization

```text
Authentication
  Who are you?

Coarse-grained authorization
  Are you generally allowed to access this endpoint?

Object-level authorization
  Are you allowed to act on this specific case/document/task?

Field/action-level authorization
  Are you allowed to see/change this field or perform this transition?
```

Jersey dapat membantu di boundary:

- authentication filter;
- `SecurityContext`;
- `@RolesAllowed`;
- request context property;
- exception mapper untuk `ForbiddenException`/custom authorization error;
- audit context.

Tetapi object-level authorization biasanya milik application/domain policy layer.

### 7.2 Example

```java
@POST
@Path("/{caseId}/actions/escalate")
@RolesAllowed("OFFICER")
public Response escalate(
        @PathParam("caseId") String caseId,
        @Valid EscalateRequest request,
        @Context SecurityContext securityContext) {

    EscalateCaseCommand command = new EscalateCaseCommand(
            CaseId.parse(caseId),
            request.reason(),
            Actor.from(securityContext)
    );

    EscalateCaseResult result = escalateCaseUseCase.escalate(command);
    return Response.ok(EscalateCaseResponse.from(result)).build();
}
```

`@RolesAllowed("OFFICER")` hanya coarse check. Use case tetap harus mengecek:

- apakah officer assigned ke case tersebut;
- apakah officer dari unit yang benar;
- apakah case sedang dalam state yang boleh dieskalasi;
- apakah escalation membutuhkan approval tambahan;
- apakah delegation aktif;
- apakah conflict-of-interest rule berlaku.

### 7.3 Confused Deputy Prevention

Confused deputy terjadi ketika service punya privilege lebih tinggi lalu tanpa sadar melakukan aksi atas nama actor yang tidak berwenang.

Mitigasi:

- command selalu membawa `Actor`;
- service tidak mengambil “current user” diam-diam dari static ThreadLocal tanpa kontrol;
- outbound gateway membawa actor/correlation/authority secara eksplisit jika diperlukan;
- audit event menyimpan actor, authority source, dan decision basis;
- object-level authorization dilakukan dekat use case.

---

## 8. Audit Boundary

Dalam sistem enterprise/regulatory, audit bukan log.

Log membantu engineer. Audit membantu pembuktian.

### 8.1 Audit Event Harus Menjawab

```text
Who did what, to which object, when, under what authority, with what input, and producing what outcome?
```

Minimal audit event:

```java
public record AuditEvent(
        String eventId,
        String correlationId,
        String actorId,
        String actorType,
        String authority,
        String action,
        String entityType,
        String entityId,
        String previousState,
        String newState,
        Instant occurredAt,
        Map<String, Object> evidence
) {}
```

### 8.2 Letak Audit

Audit dapat ditangkap di beberapa layer:

| Layer | Cocok untuk | Tidak cocok untuk |
|---|---|---|
| Jersey filter | request received, actor, URI, method, correlation | domain state transition detail |
| Resource | command accepted, request metadata | persistence-level consistency |
| Application service | use case outcome, business action | raw payload logging besar |
| Domain service/state machine | state transition reason | HTTP header/detail |
| Repository/outbox | durable persistence | semantic decision |

Pola kuat:

```text
Jersey filter creates request context
  → use case creates semantic audit event
  → audit/outbox persisted in same transaction as state change
  → async publisher sends audit to downstream if needed
```

### 8.3 Audit and Error

Audit bukan hanya untuk success. Beberapa failure juga penting:

- unauthorized attempt;
- forbidden object access;
- validation rejection for sensitive operation;
- failed approval due to invalid state;
- repeated idempotency conflict;
- suspicious file upload rejection;
- remote dependency denial.

Namun audit failure harus hati-hati agar tidak menyimpan PII/secrets/raw payload berbahaya.

---

## 9. Idempotency Boundary

Idempotency penting untuk endpoint command yang bisa di-retry client, gateway, load balancer, atau user.

### 9.1 Kapan Butuh Idempotency Key

Biasanya untuk:

- create payment;
- submit application;
- upload document metadata;
- approve/reject action;
- send notification;
- create external registration;
- long-running job submission.

### 9.2 Pattern

```text
Client sends Idempotency-Key
  ↓
Jersey filter/resource validates header
  ↓
Use case checks idempotency store
  ↓
If first request:
    execute command
    persist result fingerprint
    return response
If duplicate same payload:
    return same result
If duplicate different payload:
    return conflict
```

### 9.3 Where to Implement

Jersey filter bisa mengambil dan memvalidasi header, tetapi actual idempotency decision harus dekat use case karena perlu tahu semantic action dan payload fingerprint.

```java
public record IdempotentCommand<T>(
        String idempotencyKey,
        String payloadHash,
        Actor actor,
        T command
) {}
```

### 9.4 HTTP Semantics

HTTP method seperti PUT dan DELETE didefinisikan sebagai idempotent dalam RFC 9110, tetapi business operation di balik endpoint tetap harus dirancang benar. Jangan menganggap `POST` selalu non-idempotent atau `PUT` otomatis aman tanpa storage/locking yang benar. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)

---

## 10. Long-Running Operation Pattern

Banyak operasi enterprise tidak cocok diproses sinkron dalam satu HTTP request:

- report generation;
- bulk reassignment;
- document conversion;
- data archival;
- external verification;
- large import;
- compliance screening;
- case migration;
- notification blast.

### 10.1 Recommended Pattern

```text
POST /exports
  → validate request
  → create export job
  → return 202 Accepted + Location: /exports/{jobId}

GET /exports/{jobId}
  → return status: QUEUED/RUNNING/SUCCEEDED/FAILED

GET /exports/{jobId}/file
  → stream file if ready
```

Example:

```java
@POST
@Path("/case-exports")
public Response requestExport(
        @Valid ExportCasesRequest request,
        @Context UriInfo uriInfo,
        @Context SecurityContext securityContext) {

    ExportJob job = requestCaseExportUseCase.request(
            ExportCasesCommand.from(request, Actor.from(securityContext))
    );

    URI location = uriInfo.getAbsolutePathBuilder()
            .path(job.jobId().value())
            .build();

    return Response.accepted(ExportJobResponse.from(job))
            .location(location)
            .build();
}
```

### 10.2 Why Not Keep Request Open?

A suspended async request can help for some workflows, but long-running jobs often need durable state:

- user can refresh;
- worker can retry;
- job survives pod restart;
- audit trail exists;
- status is visible;
- failure can be investigated;
- large output can be downloaded later.

Async HTTP is not a replacement for durable job orchestration.

---

## 11. Command Endpoint vs Query Endpoint

A clean API distinguishes commands and queries.

### 11.1 Command Endpoint

Command changes state.

Examples:

```text
POST /cases
POST /cases/{caseId}/actions/submit
POST /cases/{caseId}/actions/approve
POST /cases/{caseId}/actions/escalate
DELETE /cases/{caseId}/documents/{documentId}
PUT /cases/{caseId}/assignment
```

Command concerns:

- authorization;
- invariant;
- transaction;
- audit;
- idempotency;
- state transition;
- event/outbox;
- conflict handling.

### 11.2 Query Endpoint

Query reads state.

Examples:

```text
GET /cases/{caseId}
GET /cases?status=SUBMITTED&assignedTo=me
GET /cases/{caseId}/timeline
GET /cases/{caseId}/documents
GET /cases/{caseId}/audit-events
```

Query concerns:

- projection shape;
- pagination;
- sorting;
- filtering;
- field-level visibility;
- caching;
- data freshness;
- performance;
- index support;
- export safety.

### 11.3 Do Not Hide Commands Behind Query

Avoid:

```text
GET /cases/{caseId}/approve
GET /reports/generate
```

GET should be safe. If request causes state change, use POST/PUT/PATCH/DELETE according to semantics.

---

## 12. Bulk Operation Pattern

Bulk operations are dangerous because they combine scale, partial failure, authorization, idempotency, and audit.

### 12.1 Avoid Naive Bulk

Naive:

```text
POST /cases/bulk-approve
body: [caseId1, caseId2, caseId3, ...]
```

Problems:

- what if case 17 fails?
- all-or-nothing or partial?
- how to audit each case?
- how to handle duplicate request?
- how to prevent massive lock contention?
- how to authorize each case?
- how to report results?

### 12.2 Better Bulk Pattern

For small bounded bulk:

```text
POST /case-actions/bulk-approval
```

Request:

```json
{
  "caseIds": ["C-001", "C-002"],
  "decision": "APPROVE",
  "reason": "Batch approval after review"
}
```

Response:

```json
{
  "operationId": "BULK-123",
  "summary": {
    "requested": 2,
    "succeeded": 1,
    "failed": 1
  },
  "items": [
    {"caseId": "C-001", "status": "SUCCEEDED"},
    {"caseId": "C-002", "status": "FAILED", "errorCode": "INVALID_STATE"}
  ]
}
```

For large bulk:

```text
POST /bulk-operations
GET  /bulk-operations/{operationId}
```

### 12.3 Bulk Design Checklist

A bulk endpoint must define:

- maximum item count;
- all-or-nothing vs partial success;
- per-item authorization;
- per-item validation;
- per-item audit;
- idempotency behavior;
- ordering guarantee;
- concurrency control;
- failure result shape;
- retry semantics;
- async vs sync threshold.

---

## 13. Search Endpoint Pattern

Search endpoints often become unbounded database abuse.

### 13.1 Query Design

For simple filters:

```text
GET /cases?status=OPEN&assignedTo=me&page=1&pageSize=50
```

For complex search:

```text
POST /case-searches
```

or:

```text
POST /cases/search
```

This is acceptable when query body is complex and not naturally represented by query parameters. The endpoint is still semantically read-only, but HTTP method becomes POST due to request body complexity and URL length constraints.

### 13.2 Search Request DTO

```java
public record CaseSearchRequest(
        List<String> statuses,
        String assignedOfficerId,
        LocalDate submittedFrom,
        LocalDate submittedTo,
        String keyword,
        PageRequest page,
        List<SortField> sort
) {}
```

### 13.3 Search Constraints

Search API must define:

- max page size;
- default sort;
- allowed sort fields;
- allowed filter combinations;
- date range limit;
- keyword length;
- index-backed fields;
- authorization filter;
- tenant filter;
- response projection;
- timeout/fail-fast behavior.

### 13.4 Avoid “Expose SQL as API”

Never expose arbitrary SQL-like filters unless you are intentionally building a governed query language with strict parsing, authorization, quota, and cost limits.

---

## 14. Export Endpoint Pattern

Export is not just a bigger search.

Export needs:

- async job;
- permission check;
- row limit;
- field masking;
- file retention policy;
- audit;
- secure download;
- content type;
- checksum;
- expiration;
- rerun semantics.

### 14.1 Flow

```text
POST /case-exports
  → create export job

GET /case-exports/{exportId}
  → status

GET /case-exports/{exportId}/file
  → stream file
```

### 14.2 Streaming Response

```java
@GET
@Path("/case-exports/{exportId}/file")
public Response downloadExport(@PathParam("exportId") String exportId) {
    ExportFile file = getExportFileUseCase.get(ExportId.parse(exportId));

    StreamingOutput output = out -> fileStore.streamTo(file.storageKey(), out);

    return Response.ok(output, file.contentType())
            .header("Content-Disposition", "attachment; filename=\"" + file.safeFilename() + "\"")
            .header("Digest", file.digestHeader())
            .build();
}
```

Never build huge export file fully in memory inside resource.

---

## 15. Document Endpoint Pattern

Documents need more defensive design than normal JSON APIs.

### 15.1 Separate Metadata and Binary

Pattern:

```text
POST /documents
  → create document metadata / upload session

PUT /documents/{documentId}/content
  → upload binary

GET /documents/{documentId}
  → metadata

GET /documents/{documentId}/content
  → download binary
```

or multipart if atomic metadata + file upload is truly needed.

### 15.2 Document Security

Must handle:

- filename sanitization;
- MIME validation;
- extension allowlist;
- size limit;
- malware scanning;
- hash/digest;
- content-disposition safety;
- access control by case/object;
- retention policy;
- deletion semantics;
- audit event for upload/download/delete;
- download watermarking if required.

### 15.3 Do Not Trust Browser MIME

The client-provided `Content-Type` and filename are hints, not truth.

---

## 16. Workflow / Case Management API Pattern

For case-management systems, the API should reflect domain intent, not internal database tables.

### 16.1 State as First-Class Concept

Example case states:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_INFORMATION
APPROVED
REJECTED
CLOSED
ESCALATED
```

Do not expose generic update endpoint that allows arbitrary status mutation:

```text
PATCH /cases/{caseId}
{ "status": "APPROVED" }
```

Prefer intention-revealing action endpoint:

```text
POST /cases/{caseId}/actions/submit
POST /cases/{caseId}/actions/request-information
POST /cases/{caseId}/actions/approve
POST /cases/{caseId}/actions/reject
POST /cases/{caseId}/actions/escalate
POST /cases/{caseId}/actions/close
```

### 16.2 Why Action Endpoint Can Be Better

Pure REST purists may dislike action endpoints. But in enterprise workflow, action endpoint often communicates intent better than generic PATCH.

The important rule is not “never use action noun”. The important rule is:

- the operation must have clear semantics;
- state transition must be explicit;
- authorization must be clear;
- audit event must be clear;
- idempotency/conflict behavior must be clear.

### 16.3 State Transition Result

```json
{
  "caseId": "C-2026-0001",
  "previousStatus": "UNDER_REVIEW",
  "newStatus": "APPROVED",
  "transitionId": "T-991",
  "decidedBy": "officer-123",
  "decidedAt": "2026-06-16T08:15:30Z",
  "links": [
    {"rel": "self", "href": "/cases/C-2026-0001"},
    {"rel": "timeline", "href": "/cases/C-2026-0001/timeline"}
  ]
}
```

---

## 17. Regulatory Defensibility

Regulatory-grade systems need APIs that can be defended later.

Defensibility means:

```text
A future reviewer can reconstruct why the system accepted/rejected/changed something.
```

### 17.1 API-Level Evidence

Endpoint design should preserve:

- actor identity;
- authority / role / delegation;
- request source;
- correlation ID;
- input payload hash;
- validation result;
- decision reason;
- previous state;
- new state;
- timestamp;
- version of rule/policy used;
- downstream dependency result;
- generated document/report reference.

### 17.2 Avoid Untraceable Mutation

Bad:

```text
PATCH /cases/{caseId}
{ "status": "CLOSED" }
```

Without explicit reason, authority, and transition event, later investigation becomes difficult.

Better:

```text
POST /cases/{caseId}/actions/close
{
  "reasonCode": "DUPLICATE_APPLICATION",
  "note": "Applicant submitted duplicate case under C-2026-0088"
}
```

### 17.3 Audit Event Tied to API Intent

```text
HTTP request:
POST /cases/C-001/actions/close

Application command:
CloseCaseCommand(caseId=C-001, reason=DUPLICATE_APPLICATION, actor=officer-123)

Domain transition:
UNDER_REVIEW → CLOSED

Audit event:
CASE_CLOSED
```

This chain is explainable.

---

## 18. Error Contract as Architecture

Error response is not cosmetic.

It is part of the enterprise contract.

Problem Details is now standardized by RFC 9457, which obsoletes RFC 7807. It defines a machine-readable way to represent HTTP API errors. [RFC 9457](https://www.rfc-editor.org/info/rfc9457/)

### 18.1 Recommended Shape

```json
{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "The case cannot be approved while it is in DRAFT state.",
  "instance": "/cases/C-001/actions/approve",
  "errorCode": "CASE_INVALID_STATE_TRANSITION",
  "correlationId": "01J...",
  "details": {
    "caseId": "C-001",
    "currentState": "DRAFT",
    "requiredState": "UNDER_REVIEW"
  }
}
```

### 18.2 Error Taxonomy

Design error codes by category:

```text
VALIDATION_*
AUTHENTICATION_*
AUTHORIZATION_*
CASE_*
DOCUMENT_*
WORKFLOW_*
IDEMPOTENCY_*
CONFLICT_*
DEPENDENCY_*
SYSTEM_*
```

### 18.3 Mapping Layer

Resource should not manually build every error response. Use `ExceptionMapper`.

```text
DomainException
  → ExceptionMapper
  → Problem Details response
```

This keeps error contract consistent.

---

## 19. Pagination and Projection Pattern

Enterprise APIs often fail under read load because list endpoints are unbounded.

### 19.1 Pagination Contract

```text
GET /cases?page=1&pageSize=50
```

Response:

```json
{
  "items": [],
  "page": {
    "number": 1,
    "size": 50,
    "totalItems": 812,
    "totalPages": 17
  },
  "links": [
    {"rel": "self", "href": "/cases?page=1&pageSize=50"},
    {"rel": "next", "href": "/cases?page=2&pageSize=50"}
  ]
}
```

### 19.2 Offset vs Cursor

Offset pagination:

- simple;
- works for admin list;
- can be slow for deep pages;
- unstable under concurrent changes.

Cursor pagination:

- better for large/infinite list;
- stable if sort key is deterministic;
- more complex;
- less friendly for random page access.

### 19.3 Projection

Avoid returning full case detail in list endpoint.

```text
GET /cases          → summary projection
GET /cases/{id}     → detail projection
GET /cases/{id}/timeline → timeline projection
GET /cases/{id}/documents → document projection
```

This reduces serialization cost, DB joins, and accidental data exposure.

---

## 20. API Boundary and Events

Many enterprise actions should emit events.

Do not publish remote events directly from resource after response mapping. Prefer use case/outbox.

### 20.1 Transactional Outbox

```text
begin transaction
  update aggregate
  insert audit event
  insert outbox event
commit

background publisher
  reads outbox
  publishes to broker
  marks published
```

This prevents the classic bug:

```text
DB commit succeeds, message publish fails
```

or:

```text
message publish succeeds, DB rollback happens
```

### 20.2 Jersey Role

Jersey resource should initiate command. It should not own event reliability.

---

## 21. Multi-Tenancy Boundary

If system is multi-tenant or agency-scoped, tenant context must be first-class.

### 21.1 Tenant Sources

Tenant can come from:

- token claim;
- hostname;
- path segment;
- header from trusted gateway;
- user assignment;
- selected workspace.

### 21.2 Tenant Validation

Never trust tenant header from public client unless injected by trusted infrastructure.

```text
Request header tenant = advisory only
Token tenant claim = stronger
Server-side membership check = required
```

### 21.3 Resource Pattern

```java
@GET
@Path("/cases/{caseId}")
public CaseDetailResponse getCase(
        @PathParam("caseId") String caseId,
        @Context SecurityContext securityContext) {

    Actor actor = Actor.from(securityContext);
    return CaseDetailResponse.from(getCaseUseCase.get(new GetCaseQuery(CaseId.parse(caseId), actor)));
}
```

Use case enforces tenant/object membership.

---

## 22. Layered Observability Pattern

Observability should align with architecture boundaries.

| Boundary | Signal |
|---|---|
| Jersey filter | request count, latency, URI template, status, actor category |
| Exception mapper | error code, failure category, status |
| Use case | business operation duration, outcome |
| Repository | DB latency, row count, lock wait |
| Outbound gateway | dependency latency, timeout, retry, status |
| Audit/outbox | publish lag, failure count |

### 22.1 Naming

Avoid high-cardinality metric labels:

Bad:

```text
http.server.requests{path="/cases/C-2026-001"}
```

Good:

```text
http.server.requests{route="/cases/{caseId}"}
```

### 22.2 Correlation

Correlation ID should flow:

```text
incoming HTTP request
  → Jersey request context
  → logs MDC
  → application command
  → audit event
  → outbound client header
  → async job/outbox
```

---

## 23. Java 8–25 Architecture Considerations

### 23.1 Java 8

Constraints:

- no records;
- older TLS defaults;
- older GC choices;
- no virtual threads;
- likely Jersey 2.x / `javax.ws.rs` ecosystem;
- migration risk to Jakarta namespace.

Recommendations:

- use immutable DTO classes manually;
- keep adapter/use case separation;
- avoid relying on classpath magic;
- build migration tests early.

### 23.2 Java 11/17

Better baseline for modern enterprise:

- stronger runtime baseline;
- better container support;
- better TLS/security defaults;
- easier migration toward Jakarta.

### 23.3 Java 21/25

Modern features can improve architecture ergonomics:

- records for DTO/command/result;
- sealed interfaces for result/error taxonomy;
- virtual threads for blocking workloads if container/runtime supports them;
- better GC/runtime tooling.

But architecture still matters more than syntax. Virtual threads do not fix wrong transaction boundary, unbounded query, missing idempotency, or accidental data exposure.

---

## 24. Recommended Enterprise Package Structure

One possible structure:

```text
com.example.caseapi
  ├── api
  │   ├── resource
  │   │   ├── CaseResource.java
  │   │   ├── DocumentResource.java
  │   │   └── ExportResource.java
  │   ├── dto
  │   │   ├── request
  │   │   └── response
  │   ├── mapper
  │   │   ├── CaseApiMapper.java
  │   │   └── ProblemMapper.java
  │   ├── filter
  │   │   ├── CorrelationIdFilter.java
  │   │   ├── AuthenticationFilter.java
  │   │   └── RequestAuditFilter.java
  │   └── config
  │       └── JerseyApplicationConfig.java
  │
  ├── application
  │   ├── command
  │   ├── query
  │   ├── usecase
  │   └── result
  │
  ├── domain
  │   ├── model
  │   ├── policy
  │   ├── workflow
  │   └── event
  │
  ├── infrastructure
  │   ├── persistence
  │   ├── client
  │   ├── file
  │   ├── messaging
  │   └── audit
  │
  └── platform
      ├── idempotency
      ├── observability
      ├── security
      └── error
```

The package structure is not the architecture. But it can reinforce boundaries.

---

## 25. Anti-Patterns

### 25.1 Resource God Class

One resource class handles every action and contains business rules.

Symptom:

- 2,000-line resource;
- huge method;
- manual transaction;
- manual error response;
- repository directly injected everywhere.

Fix:

- split by API resource;
- move use case logic to application layer;
- create command/query objects;
- centralize exception mapping.

### 25.2 Entity-as-API

Persistence entity returned directly.

Fix:

- create response DTO;
- map explicitly;
- define projection per endpoint.

### 25.3 Generic Update Endpoint

```text
PATCH /cases/{id}
```

used for every workflow transition.

Fix:

- intention-revealing commands;
- state machine in domain/application layer;
- explicit audit events.

### 25.4 Filter Does Business Logic

Filter approves/rejects business operation based on body content.

Fix:

- filter handles cross-cutting HTTP concerns;
- use case handles business decision.

### 25.5 Hidden Context Everywhere

Everything reads static `CurrentUser.get()` or `TenantContext.get()`.

Fix:

- use explicit Actor/Tenant in command;
- ThreadLocal only as boundary convenience, not domain dependency.

### 25.6 Synchronous Everything

Endpoint waits for report generation, external verification, email sending, and file conversion.

Fix:

- durable job;
- outbox;
- 202 response;
- status endpoint.

---

## 26. Design Review Checklist

Before accepting a Jersey endpoint into enterprise production, ask:

### HTTP Contract

- Is method semantically correct?
- Is URI intention clear?
- Are status codes defined?
- Are error codes defined?
- Are headers defined if needed?
- Is idempotency behavior defined?

### Request/Response

- Are request DTOs separate from domain/entity?
- Are response DTOs curated?
- Is null/default/absent behavior clear?
- Is validation boundary clear?

### Security

- Is authentication handled?
- Is coarse authorization handled?
- Is object-level authorization handled?
- Is tenant boundary enforced?
- Is field-level visibility considered?

### Transaction and Consistency

- Where does transaction begin/end?
- Are external calls outside long DB transaction?
- Is outbox needed?
- Is audit persisted atomically with state change?

### Audit and Defensibility

- Who did what?
- Under what authority?
- To which object?
- What previous/new state?
- What input/evidence?
- What correlation ID?

### Observability

- Is route template captured?
- Is correlation ID propagated?
- Are failures mapped consistently?
- Are dependency calls measured?
- Are sensitive values masked?

### Performance

- Is list endpoint bounded?
- Is export async?
- Is file streaming used?
- Are N+1 and large serialization avoided?
- Are payload limits enforced?

### Evolution

- Is DTO versioning considered?
- Is removing/renaming fields avoided?
- Is error contract stable?
- Is backward compatibility tested?

---

## 27. Mini Capstone Preview

Part 32 will combine everything into a production-grade Jersey platform module. The platform module will include:

- explicit `ResourceConfig`;
- JSON provider strategy;
- problem details error mapper;
- correlation ID filter;
- request logging with masking;
- authentication/security context filter;
- validation mapper;
- idempotency filter;
- audit event hook;
- outbound Jersey client factory;
- timeout/retry policy;
- health endpoint;
- OpenTelemetry integration pattern;
- test harness;
- deployment checklist;
- Java 8/17/21/25 compatibility notes.

---

## 28. Summary

Jersey shines when treated as a precise HTTP/API runtime and boundary adapter.

The top-level architecture lesson:

```text
Do not put the enterprise system inside Jersey resource classes.
Use Jersey resource classes to expose a disciplined boundary into the enterprise system.
```

A production-grade Jersey API should make these boundaries explicit:

- HTTP boundary;
- DTO boundary;
- command/query boundary;
- transaction boundary;
- authorization boundary;
- audit boundary;
- idempotency boundary;
- observability boundary;
- asynchronous job boundary;
- compatibility boundary.

The best engineers do not only ask:

> Can this endpoint work?

They ask:

> Can this endpoint be maintained, debugged, secured, audited, evolved, retried, tested, and defended years later?

That is the difference between a working Jersey API and an enterprise-grade Jersey API.

---

## 29. References

- Jakarta RESTful Web Services 4.0 Specification: <https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0>
- Eclipse Jersey User Guide: <https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/index.html>
- RFC 9110 — HTTP Semantics: <https://www.rfc-editor.org/rfc/rfc9110.html>
- RFC 9457 — Problem Details for HTTP APIs: <https://www.rfc-editor.org/info/rfc9457/>

---

## 30. Status Seri

Progress:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — selesai
Part 15 — selesai
Part 16 — selesai
Part 17 — selesai
Part 18 — selesai
Part 19 — selesai
Part 20 — selesai
Part 21 — selesai
Part 22 — selesai
Part 23 — selesai
Part 24 — selesai
Part 25 — selesai
Part 26 — selesai
Part 27 — selesai
Part 28 — selesai
Part 29 — selesai
Part 30 — selesai
Part 31 — selesai
Part 32 — berikutnya / capstone terakhir
```

Seri belum selesai. Part berikutnya adalah bagian terakhir:

> Part 32 — Capstone: Building a Production-Grade Jersey Platform Module
