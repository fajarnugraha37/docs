# Strict Coding Standards — JAX-RS / Jakarta RESTful Web Services

> **Target:** Java REST APIs implemented with JAX-RS / Jakarta RESTful Web Services  
> **Scope:** server resources, client API, DTOs, exception mapping, filters/interceptors, providers, validation, multipart, SSE, security, tests, and LLM implementation rules  
> **Audience:** LLM code agents, human reviewers, maintainers, tech leads  
> **Purpose:** prevent framework-shaped but semantically broken REST code: fat resources, accidental state mutation through `GET`, mixed `javax`/`jakarta` packages, leaky domain entities, inconsistent error responses, unsafe filters, and undocumented HTTP behavior.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing JAX-RS/Jakarta REST code, an LLM agent **MUST** treat HTTP as the public contract and JAX-RS annotations as the adapter syntax.

The agent **MUST NOT** implement an endpoint by merely adding `@Path`, `@GET`, `@POST`, and returning whatever object compiles.

Every endpoint **MUST** make these decisions explicit:

1. Which resource is being exposed.
2. Which HTTP method semantics apply.
3. Which request representation is accepted.
4. Which response representation is produced.
5. Which status codes are possible.
6. Which validation rules are enforced at the boundary.
7. Which domain/service operation is invoked.
8. Which errors are mapped to client-safe responses.
9. Which authorization rule protects the operation.
10. Which idempotency/concurrency behavior applies for state-changing operations.
11. Which observability data is emitted without leaking sensitive data.
12. Which tests prove the endpoint contract.

If any of these are unclear, the agent **MUST** choose the most conservative implementation and mark the uncertainty in the implementation notes or PR summary.

---

## 1. Terminology and version model

Historically, many teams call the API **JAX-RS** even when using the modern Jakarta namespace. This document uses both terms carefully.

| Common name | Package namespace | Typical platform | Notes |
|---|---|---|---|
| JAX-RS 2.x | `javax.ws.rs.*` | Java EE 7/8, Jakarta EE 8 compatibility era | Legacy namespace. Do not mix with `jakarta.ws.rs.*`. |
| Jakarta REST 3.x | `jakarta.ws.rs.*` | Jakarta EE 9/10 | Namespace migrated to `jakarta`. Jakarta REST 3.1 adds Java SE bootstrap API, multipart media type support, JSON-B alignment, provider extension loading, and deprecates `@Context` in preparation for CDI alignment. |
| Jakarta REST 4.x | `jakarta.ws.rs.*` | Jakarta EE 11 | Removes JAXB dependency and ManagedBean support from the specification, adds JSON Merge Patch support and API conveniences. |
| Jakarta REST 5.x | `jakarta.ws.rs.*` | Jakarta EE 12 under development | **Forbidden by default** unless the project explicitly targets an unreleased/under-development platform. |

### 1.1 Namespace rule

A project **MUST** use exactly one namespace family:

```java
// Legacy only
import javax.ws.rs.GET;
import javax.ws.rs.Path;

// Modern Jakarta only
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
```

The agent **MUST NOT** mix these in the same module:

```java
// FORBIDDEN
import javax.ws.rs.GET;
import jakarta.ws.rs.Path;
```

The namespace is a platform compatibility decision, not a stylistic decision.

### 1.2 Dependency rule

For Jakarta REST 4.0 / Jakarta EE 11 style projects:

```xml
<dependency>
    <groupId>jakarta.ws.rs</groupId>
    <artifactId>jakarta.ws.rs-api</artifactId>
    <version>4.0.0</version>
    <scope>provided</scope>
</dependency>
```

For Jakarta EE container projects, API dependencies **SHOULD** usually be `provided`, because the runtime supplies the implementation.

For standalone Java SE projects, the agent **MUST** include an actual implementation dependency, not only the API jar. Example implementations include Jersey, RESTEasy, Open Liberty, Payara, and other compatible runtimes. The exact implementation **MUST** follow the project stack.

### 1.3 Runtime ownership rule

The agent **MUST** identify who owns these concerns:

| Concern | Usually owned by |
|---|---|
| Request routing | JAX-RS runtime |
| Serialization/deserialization | Message body providers, JSON-B/Jackson provider, runtime config |
| Dependency injection | CDI or application framework |
| Transactions | Service/application layer, not resource method by default |
| Authorization | Security layer/filter/service policy |
| Business rules | Application/domain service |
| Persistence | Repository/DAO layer |
| Response mapping | Resource + mapper layer |
| Error mapping | ExceptionMapper / centralized error mapper |
| Metrics/tracing/logging | Filters/interceptors + service instrumentation |

Resource classes **MUST NOT** become the owner of business rules, persistence, workflow transitions, or external integration retry policies.

---

## 2. Relationship with Java version standards

This document is an overlay standard.

It **DOES NOT** replace:

- `strict-coding-standards__java11.md`
- `strict-coding-standards__java17.md`
- `strict-coding-standards__java21.md`
- `strict-coding-standards__java25.md`
- `strict-coding-standards__design_pattern_in_java.md`

The agent **MUST** first obey the Java baseline of the project.

### 2.1 Java baseline compatibility

| Java baseline | JAX-RS/Jakarta REST implementation guidance |
|---|---|
| Java 11 | Use Jakarta REST 3.1 only if project is already on Jakarta namespace. Use Java 11-compatible DTOs/classes. Records are forbidden. |
| Java 17 | Jakarta EE 11 minimum Java SE version is Java 17. Records may be used for request/response DTOs if the chosen JSON provider supports them correctly. |
| Java 21 | Virtual threads may be used by the runtime/framework only when explicitly supported. Do not assume JAX-RS resource code becomes safe just because threads are cheap. |
| Java 25 | Follow Java 25 strict standard. Do not use preview/incubator APIs in REST resources. |

### 2.2 Records as DTOs

For Java 17+, records are allowed for request/response DTOs only when:

1. The JSON provider supports record serialization/deserialization in the project runtime.
2. The DTO is immutable and shallow enough to be readable.
3. Validation annotations are supported on record components by the runtime stack.
4. No framework proxying requirement forces a no-arg mutable bean.

Allowed:

```java
public record CreateCaseRequest(
        @NotBlank String title,
        @NotBlank String category,
        @Size(max = 1000) String description
) {
}
```

Forbidden when runtime compatibility is unknown:

```java
// FORBIDDEN until provider/runtime support is confirmed.
public record UploadRequest(InputStream file, String filename) {
}
```

For multipart, streaming, and lifecycle-sensitive payloads, prefer explicit classes or direct method parameters.

---

## 3. Application configuration standards

### 3.1 Portable configuration

JAX-RS resources and providers are configured through an `Application` subclass. Runtime scanning may work, but an `Application` subclass is the portable configuration point.

Required:

```java
@ApplicationPath("/api")
public final class ApiApplication extends Application {
}
```

For explicit class registration:

```java
@ApplicationPath("/api")
public final class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
                CaseResource.class,
                GlobalExceptionMapper.class,
                CorrelationIdFilter.class
        );
    }
}
```

Rules:

1. The base path **MUST** be stable and version-aware if the API uses URI versioning.
2. The agent **MUST NOT** hide resources through undocumented classpath scanning assumptions.
3. If `getClasses()` or `getSingletons()` is overridden, the agent **MUST** ensure all required resources/providers are registered.
4. `getSingletons()` **MUST NOT** return mutable resource instances unless thread safety is proven.
5. Provider registration **MUST** be deliberate for security, error mapping, JSON, logging, and auth filters.

### 3.2 Application path rule

Allowed:

```java
@ApplicationPath("/api/v1")
public final class PublicApiApplication extends Application {
}
```

Avoid unless the organization standard requires external gateway versioning:

```java
@ApplicationPath("/")
public final class RootApplication extends Application {
}
```

Forbidden:

```java
// FORBIDDEN: vague, environment-specific, not a contract.
@ApplicationPath("/test")
public final class ApiApplication extends Application {
}
```

---

## 4. Resource class standards

### 4.1 Resource class role

A resource class is a delivery adapter.

It **MUST**:

1. Accept HTTP input.
2. Validate input shape and boundary constraints.
3. Convert request DTOs/params to application commands/queries.
4. Call one application service/use case.
5. Convert result to response DTO/HTTP response.
6. Avoid exposing internals.

It **MUST NOT**:

1. Implement business workflows directly.
2. Query repositories directly unless the project explicitly uses transaction script and the operation is trivial.
3. Build SQL, JPQL, or dynamic queries inline.
4. Perform remote API retries inline.
5. Contain transaction orchestration except through a declared service boundary.
6. Catch broad exceptions to return ad hoc strings.
7. Return JPA entities as API responses.
8. Store request-specific state in fields.
9. Use static mutable state.

Allowed structure:

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public final class CaseResource {

    private final CaseApplicationService caseService;
    private final CaseResponseMapper responseMapper;

    @Inject
    public CaseResource(CaseApplicationService caseService,
                        CaseResponseMapper responseMapper) {
        this.caseService = Objects.requireNonNull(caseService, "caseService");
        this.responseMapper = Objects.requireNonNull(responseMapper, "responseMapper");
    }

    @POST
    public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
        CaseId caseId = caseService.createCase(request.toCommand());
        URI location = uriInfo.getAbsolutePathBuilder()
                .path(caseId.value())
                .build();

        return Response.created(location)
                .entity(new CreateCaseResponse(caseId.value()))
                .build();
    }
}
```

Forbidden structure:

```java
@Path("/cases")
public class CaseResource {

    @PersistenceContext
    EntityManager em;

    @POST
    public Response create(Map<String, Object> body) {
        // FORBIDDEN: no DTO, no validation, persistence in resource, stringly typed body.
        CaseEntity entity = new CaseEntity();
        entity.setTitle((String) body.get("title"));
        em.persist(entity);
        return Response.ok(entity).build();
    }
}
```

### 4.2 Resource lifecycle and thread safety

The agent **MUST** assume resource instances can be managed by the runtime and lifecycle behavior may vary by container/framework.

Rules:

1. Resource fields **MUST** be immutable dependencies only.
2. Request data **MUST** be method-local.
3. Do not cache `UriInfo`, `HttpHeaders`, `SecurityContext`, request DTOs, or request-scoped data in fields.
4. Do not use instance fields as counters, buffers, or flags.
5. If a singleton resource is explicitly used, all fields **MUST** be thread-safe and request-specific state **MUST NOT** be stored.

Forbidden:

```java
@Path("/reports")
public final class ReportResource {
    private String currentUser; // FORBIDDEN: request state in resource field.

    @GET
    public Response get(@Context SecurityContext securityContext) {
        currentUser = securityContext.getUserPrincipal().getName();
        return Response.ok().build();
    }
}
```

Allowed:

```java
@GET
public Response get(@Context SecurityContext securityContext) {
    String currentUser = securityContext.getUserPrincipal().getName();
    return Response.ok(reportService.getForUser(currentUser)).build();
}
```

### 4.3 Constructor injection rule

Prefer constructor injection for dependencies:

```java
@Inject
public CaseResource(CaseApplicationService caseService) {
    this.caseService = Objects.requireNonNull(caseService, "caseService");
}
```

Avoid field injection for dependencies unless forced by legacy framework constraints:

```java
// AVOID unless legacy container requires it.
@Inject
CaseApplicationService caseService;
```

Never inject request-specific parameter annotations into fields unless the lifecycle is known to be per-request and the codebase standard allows it.

Preferred:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) {
    return responseMapper.toResponse(caseService.get(new CaseId(caseId)));
}
```

Avoid:

```java
// AVOID: request value hidden as mutable field.
@PathParam("caseId")
private String caseId;
```

### 4.4 Class naming

Resource names **MUST** represent resources, not actions.

Allowed:

```text
CaseResource
CaseAttachmentResource
CaseCommentResource
LicenceApplicationResource
CandidateExamResource
```

Forbidden:

```text
CreateCaseEndpoint
SubmitHandler
CaseControllerController
CaseManagerResource
DoActionResource
RestApiService
```

If the endpoint represents a workflow command, use a domain resource or command sub-resource name:

Allowed:

```java
@Path("/cases/{caseId}/submission")
public final class CaseSubmissionResource {
    @PUT
    public Response submit(@PathParam("caseId") String caseId) { ... }
}
```

Avoid:

```java
@Path("/submitCase")
public final class SubmitCaseResource { ... }
```

---

## 5. URI and path design standards

### 5.1 Resource-oriented paths

Paths **MUST** describe resources, collections, or sub-resources.

Allowed:

```text
GET    /cases
POST   /cases
GET    /cases/{caseId}
PUT    /cases/{caseId}
DELETE /cases/{caseId}
GET    /cases/{caseId}/attachments
POST   /cases/{caseId}/attachments
GET    /cases/{caseId}/attachments/{attachmentId}
```

Avoid verb paths when a resource representation exists:

```text
POST /createCase       # FORBIDDEN
POST /updateCase       # FORBIDDEN
GET  /getCaseById      # FORBIDDEN
POST /deleteCase       # FORBIDDEN
```

Acceptable command-like sub-resources when the domain action is not a simple CRUD update:

```text
PUT  /cases/{caseId}/submission
PUT  /cases/{caseId}/approval
POST /cases/{caseId}/comments
POST /cases/{caseId}/transitions
```

But command-like endpoints **MUST** still document idempotency and allowed state transitions.

### 5.2 Path segment naming

Rules:

1. Use lowercase kebab-case for multiword segments.
2. Use plural nouns for collections.
3. Use stable domain terms, not implementation names.
4. Do not expose database table names.
5. Do not expose class names or package names.
6. Do not use file extensions for format negotiation unless legacy clients require it.

Allowed:

```text
/licence-applications/{applicationId}/documents
/case-officers/{officerId}/assignments
/exam-sessions/{sessionId}/candidates
```

Forbidden:

```text
/LicenceApplicationEntity/{id}
/tbl_case/{id}
/getCandidateDTO/{candidate_id}
/service/v1/CaseServiceImpl/query
```

### 5.3 Path parameter standards

Use domain-specific parameter names:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) { ... }
```

Avoid generic names:

```java
// AVOID
@Path("/{id}")
public CaseResponse get(@PathParam("id") String id) { ... }
```

Generic `id` is allowed only in very local sub-resource contexts where the type is obvious and the project standard accepts it.

### 5.4 Path parameter validation

Path parameters **MUST** be validated before use.

Allowed:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") @NotBlank String caseId) {
    return mapper.toResponse(caseService.get(CaseId.parse(caseId)));
}
```

Better when using domain parser:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String rawCaseId) {
    CaseId caseId = CaseId.parse(rawCaseId);
    return mapper.toResponse(caseService.get(caseId));
}
```

The domain parser **MUST** reject invalid format with a domain exception mapped to a safe 400 response.

### 5.5 Regex in `@Path`

Regex path constraints are allowed only for simple, stable, readable constraints.

Allowed:

```java
@GET
@Path("/{year: \\d{4}}")
public YearSummaryResponse getYearSummary(@PathParam("year") int year) { ... }
```

Forbidden:

```java
// FORBIDDEN: unreadable, fragile, domain validation hidden in routing.
@Path("/{caseId: ([A-Z]{2,5})-(\\d{4})-(\\d{1,10})-(OPEN|CLOSED|DRAFT)}")
```

Complex validation belongs in a domain parser/validator, not in the routing expression.

### 5.6 Query parameter standards

Query parameters **MUST** be used for filtering, sorting, pagination, sparse fields, and optional representation controls.

Allowed:

```text
GET /cases?status=open&assignedTo=me&page=1&pageSize=50&sort=createdAt,desc
```

Forbidden:

```text
GET /cases?action=delete&id=123       # unsafe action through GET
GET /cases?sql=select * from cases    # data access leakage
GET /cases?class=CaseEntity           # implementation leakage
```

### 5.7 Query DTO / parameter object

When query parameters exceed three or have validation rules, use a parameter object if the framework supports it.

Allowed:

```java
public final class CaseSearchParams {

    @QueryParam("status")
    private String status;

    @QueryParam("assignedTo")
    private String assignedTo;

    @QueryParam("page")
    @DefaultValue("1")
    @Min(1)
    private int page;

    @QueryParam("pageSize")
    @DefaultValue("50")
    @Min(1)
    @Max(100)
    private int pageSize;

    public CaseSearchQuery toQuery() {
        return new CaseSearchQuery(status, assignedTo, page, pageSize);
    }
}
```

```java
@GET
public CaseSearchResponse search(@BeanParam @Valid CaseSearchParams params) {
    return mapper.toResponse(caseService.search(params.toQuery()));
}
```

Rules:

1. Query DTOs **MUST NOT** be passed directly to repositories.
2. Convert query DTOs to application query objects.
3. Pagination defaults **MUST** be explicit.
4. Sort fields **MUST** be allow-listed.
5. Filters **MUST** not allow arbitrary field access.

---

## 6. HTTP method standards

### 6.1 Method semantics are contract, not annotation decoration

The agent **MUST** select HTTP methods by semantics.

| Method | Use | Must not |
|---|---|---|
| `GET` | Retrieve representation. Safe/read-only. | Create, update, delete, submit, approve, trigger email, run batch. |
| `HEAD` | Retrieve metadata equivalent to GET without body. | Implement separately unless needed for performance. |
| `OPTIONS` | Capability discovery / CORS runtime handling. | Business operation. |
| `POST` | Create subordinate resource, submit non-idempotent command, trigger process. | Generic tunnel for all operations. |
| `PUT` | Replace resource or idempotently set resource/sub-resource state. | Partial update unless explicitly modeled. |
| `PATCH` | Partial update using documented patch format. | Accept arbitrary partial maps without schema. |
| `DELETE` | Delete/remove/cancel resource according to domain semantics. | Soft-delete surprise without response contract. |

### 6.2 GET must be safe

`GET` methods **MUST NOT** cause intended state changes.

Allowed side effects:

1. Access logs.
2. Metrics.
3. Tracing.
4. Cache refresh that does not change business-visible state.

Forbidden side effects:

1. Creating domain records.
2. Marking tasks as processed/read unless explicitly modeled as a separate state-changing operation.
3. Sending emails.
4. Submitting workflow transitions.
5. Mutating user/session/domain state.

Forbidden:

```java
@GET
@Path("/{caseId}/approve")
public Response approve(@PathParam("caseId") String caseId) {
    caseService.approve(CaseId.parse(caseId));
    return Response.ok().build();
}
```

Allowed:

```java
@PUT
@Path("/{caseId}/approval")
public Response approve(@PathParam("caseId") String caseId,
                        @Valid ApproveCaseRequest request) {
    caseService.approve(CaseId.parse(caseId), request.toCommand());
    return Response.noContent().build();
}
```

### 6.3 POST rule

Use `POST` for non-idempotent creation or command submission.

Creation:

```java
@POST
public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
    CaseId createdId = caseService.create(request.toCommand());
    URI location = uriInfo.getAbsolutePathBuilder()
            .path(createdId.value())
            .build();

    return Response.created(location)
            .entity(new CreateCaseResponse(createdId.value()))
            .build();
}
```

Command:

```java
@POST
@Path("/{caseId}/comments")
public Response addComment(@PathParam("caseId") String caseId,
                           @Valid AddCommentRequest request,
                           @Context UriInfo uriInfo) {
    CommentId commentId = caseService.addComment(CaseId.parse(caseId), request.toCommand());
    URI location = uriInfo.getAbsolutePathBuilder()
            .path(commentId.value())
            .build();

    return Response.created(location)
            .entity(new AddCommentResponse(commentId.value()))
            .build();
}
```

For retriable POST operations, require one of:

1. `Idempotency-Key` header.
2. Client-generated resource identifier with `PUT`.
3. Natural business key enforced by unique constraint.
4. Operation token generated by the server.

### 6.4 PUT rule

Use `PUT` for idempotent replacement or idempotent state setting.

Allowed:

```java
@PUT
@Path("/{caseId}/assignment")
public Response assign(@PathParam("caseId") String caseId,
                       @Valid AssignCaseRequest request) {
    caseService.assign(CaseId.parse(caseId), request.toCommand());
    return Response.noContent().build();
}
```

The command **MUST** be safe to repeat with the same payload.

### 6.5 PATCH rule

`PATCH` is allowed only when the patch media type is explicit and validation is strong.

Allowed for JSON Merge Patch on Jakarta REST 4.0+ if supported by runtime:

```java
@PATCH
@Path("/{caseId}")
@Consumes("application/merge-patch+json")
public Response patch(@PathParam("caseId") String caseId, JsonMergePatch patch) {
    caseService.patchCase(CaseId.parse(caseId), patchMapper.toCommand(patch));
    return Response.noContent().build();
}
```

Forbidden:

```java
// FORBIDDEN: arbitrary unvalidated partial map.
@PATCH
@Path("/{caseId}")
public Response patch(@PathParam("caseId") String caseId, Map<String, Object> body) { ... }
```

Rules:

1. Patchable fields **MUST** be allow-listed.
2. Unknown fields **MUST** be rejected unless API contract says they are ignored.
3. Null semantics **MUST** be documented.
4. Patch operations **MUST** be validated after merge.
5. Patch **MUST NOT** bypass workflow/state transition guards.

### 6.6 DELETE rule

`DELETE` **MUST** document whether it means physical delete, soft delete, cancellation, archival, or logical deactivation.

Allowed:

```java
@DELETE
@Path("/{caseId}")
public Response delete(@PathParam("caseId") String caseId) {
    caseService.delete(CaseId.parse(caseId));
    return Response.noContent().build();
}
```

For regulatory/case-management systems, prefer domain terms when delete is not actually delete:

```java
@PUT
@Path("/{caseId}/cancellation")
public Response cancel(@PathParam("caseId") String caseId,
                       @Valid CancelCaseRequest request) {
    caseService.cancel(CaseId.parse(caseId), request.toCommand());
    return Response.noContent().build();
}
```

---

## 7. Request DTO standards

### 7.1 Never accept raw maps for normal JSON APIs

Forbidden:

```java
@POST
public Response create(Map<String, Object> request) { ... }
```

Allowed:

```java
public final class CreateCaseRequest {
    @NotBlank
    private String title;

    @NotBlank
    private String category;

    @Size(max = 1000)
    private String description;

    public CreateCaseCommand toCommand() {
        return new CreateCaseCommand(title, category, description);
    }
}
```

Rules:

1. Every non-trivial JSON body **MUST** have a named DTO.
2. DTO fields **MUST** have validation annotations where applicable.
3. DTO **MUST NOT** be a JPA entity.
4. DTO **MUST NOT** expose internal enum names unless those names are part of the public contract.
5. DTO **MUST** convert to application command/query before reaching domain/service layer.
6. DTO **MUST** keep backward compatibility in mind: removing/renaming fields is a breaking change.

### 7.2 One entity parameter rule

A resource method **MUST** have at most one unannotated entity parameter.

Allowed:

```java
@POST
public Response create(@Valid CreateCaseRequest request) { ... }
```

Allowed with params:

```java
@POST
@Path("/{caseId}/comments")
public Response addComment(@PathParam("caseId") String caseId,
                           @Valid AddCommentRequest request) { ... }
```

Forbidden:

```java
// FORBIDDEN: two entity bodies are impossible/ambiguous.
@POST
public Response create(CreateCaseRequest request, AuditInfo auditInfo) { ... }
```

Put the combined input into a single request DTO or derive audit info from authenticated context.

### 7.3 DTO mutability rule

For Java 11 legacy code, mutable bean DTOs are allowed if required by provider.

```java
public final class CreateCaseRequest {
    private String title;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }
}
```

Rules:

1. DTO setters **MUST NOT** contain business logic.
2. DTOs **MUST NOT** open database sessions or call services.
3. DTOs **MUST NOT** hide defaults that belong to business rules.
4. DTOs **MUST** be mapped explicitly to commands/queries.

For Java 17+ records may be used when provider support is confirmed.

### 7.4 Validation standards

Boundary validation **MUST** happen before application service execution.

Required examples:

```java
public final class SearchCaseRequest {

    @Min(1)
    private int page = 1;

    @Min(1)
    @Max(100)
    private int pageSize = 50;

    @Pattern(regexp = "OPEN|CLOSED|DRAFT")
    private String status;
}
```

Rules:

1. Use Bean Validation for structural constraints: required, length, format, min/max.
2. Use domain services/validators for cross-field and state-dependent constraints.
3. Never trust client-side validation.
4. Never accept unknown enum/status transitions silently.
5. Validation failures **MUST** map to a consistent 400 response body.
6. Return-value validation failures **MUST** be treated as server defects, not client mistakes.

### 7.5 Unknown fields policy

The API **MUST** define whether unknown JSON fields are rejected or ignored.

Preferred for internal/regulatory APIs:

```text
Unknown request fields MUST be rejected.
```

Preferred for external backwards-compatible APIs:

```text
Unknown request fields MAY be ignored only when explicitly configured and tested.
```

The agent **MUST NOT** assume provider defaults.

### 7.6 Enum input policy

Do not expose Java enum names accidentally.

Allowed if enum names are public contract:

```json
{ "status": "OPEN" }
```

Better for external APIs:

```json
{ "status": "open" }
```

Rules:

1. External enum values **MUST** be documented.
2. Unknown enum values **MUST** return 400.
3. Error response **MUST** list allowed values if safe.
4. Enum parsing **MUST** be case policy aware.

---

## 8. Response standards

### 8.1 Response type decision

Use typed return values for simple 200 responses:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) {
    return mapper.toResponse(caseService.get(CaseId.parse(caseId)));
}
```

Use `Response` when status, headers, location, cache control, ETag, or conditional behavior matters:

```java
@POST
public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
    CaseId id = caseService.create(request.toCommand());
    URI location = uriInfo.getAbsolutePathBuilder().path(id.value()).build();
    return Response.created(location).entity(new CreateCaseResponse(id.value())).build();
}
```

Rules:

1. Do not return `Response.ok()` for every operation.
2. Use `201 Created` with `Location` for creation.
3. Use `204 No Content` for successful update/delete with no response body.
4. Use `200 OK` when returning a representation.
5. Use `202 Accepted` only for asynchronous processing with a status/check resource.
6. Use `404 Not Found` only when the resource does not exist or caller must not know it exists.
7. Use `409 Conflict` for state/version/business conflicts.
8. Use `412 Precondition Failed` for failed conditional requests such as ETag/If-Match.
9. Use `415 Unsupported Media Type` for unsupported request content type.
10. Use `406 Not Acceptable` for unsupported response representation.

### 8.2 Do not return domain entities

Forbidden:

```java
@GET
@Path("/{caseId}")
public CaseEntity get(@PathParam("caseId") String caseId) {
    return repository.find(caseId);
}
```

Allowed:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) {
    CaseDetails details = caseService.get(CaseId.parse(caseId));
    return mapper.toResponse(details);
}
```

Reasons:

1. Entity fields are not API contract.
2. Lazy loading may fail or leak queries.
3. Serialization may expose sensitive fields.
4. Bidirectional relationships can recurse.
5. Persistence changes become API-breaking changes.
6. Security filtering becomes unreliable.

### 8.3 Response DTO standards

Response DTOs **MUST** be stable public contracts.

```java
public final class CaseResponse {
    private final String id;
    private final String title;
    private final String status;
    private final Instant createdAt;

    public CaseResponse(String id, String title, String status, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.title = Objects.requireNonNull(title, "title");
        this.status = Objects.requireNonNull(status, "status");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
}
```

Rules:

1. Use ISO-8601 for dates/times unless API contract says otherwise.
2. Use strings for identifiers unless numeric ID is explicitly public and stable.
3. Do not expose internal database surrogate keys unless part of public contract.
4. Do not expose stack traces, class names, package names, SQL, or internal hostnames.
5. Redact sensitive fields.

### 8.4 Collection response standards

Collection responses **MUST** define pagination behavior.

Allowed:

```json
{
  "items": [
    { "id": "CASE-001", "title": "...", "status": "open" }
  ],
  "page": {
    "number": 1,
    "size": 50,
    "totalItems": 123,
    "totalPages": 3
  }
}
```

Rules:

1. Do not return unbounded collections.
2. Default page size **MUST** be explicit.
3. Maximum page size **MUST** be enforced.
4. Sort fields **MUST** be allow-listed.
5. Filtering semantics **MUST** be documented.

### 8.5 Generic type preservation

When returning generic collections through `Response`, preserve generic type when the provider requires it.

Allowed:

```java
List<CaseResponse> cases = mapper.toResponses(result.items());
GenericEntity<List<CaseResponse>> entity = new GenericEntity<>(cases) { };
return Response.ok(entity).build();
```

Do not add `GenericEntity` everywhere by habit. Use it when the runtime/provider needs generic type information.

### 8.6 Streaming response standards

Streaming is allowed only for large payloads and must handle resource closure.

Allowed:

```java
@GET
@Path("/{documentId}/content")
@Produces(MediaType.APPLICATION_OCTET_STREAM)
public Response download(@PathParam("documentId") String documentId) {
    DocumentStream stream = documentService.open(DocumentId.parse(documentId));

    StreamingOutput output = out -> {
        try (InputStream in = stream.inputStream()) {
            in.transferTo(out);
        }
    };

    return Response.ok(output)
            .header(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + stream.safeFilename() + "\"")
            .build();
}
```

Rules:

1. Do not load large files into byte arrays.
2. Do not log binary content.
3. Do not trust raw filenames in `Content-Disposition`.
4. Set content type explicitly.
5. Consider content length if known.
6. Ensure access control before opening the stream.
7. Ensure streams are closed.

---

## 9. Content negotiation and media type standards

### 9.1 Always declare `@Consumes` and `@Produces`

At class level for common defaults:

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public final class CaseResource { ... }
```

Override at method level when needed:

```java
@GET
@Path("/{documentId}/content")
@Produces(MediaType.APPLICATION_OCTET_STREAM)
public Response download(@PathParam("documentId") String documentId) { ... }
```

Rules:

1. JSON endpoints **MUST** declare `application/json` or versioned media type.
2. Binary endpoints **MUST** declare exact media type or `application/octet-stream`.
3. Error endpoints **SHOULD** produce `application/problem+json` if RFC 9457 problem details are adopted.
4. Do not rely on provider defaults.

### 9.2 Media type constants

Allowed:

```java
@Produces(MediaType.APPLICATION_JSON)
```

Allowed for custom media types:

```java
public final class ApiMediaTypes {
    public static final String CASE_V1_JSON = "application/vnd.example.case.v1+json";

    private ApiMediaTypes() {
    }
}
```

Forbidden:

```java
@Produces("json")          // FORBIDDEN
@Consumes("application/*") // FORBIDDEN for write endpoint unless justified
```

### 9.3 Versioning policy

The project **MUST** choose one primary API versioning model:

| Model | Example | Notes |
|---|---|---|
| URI versioning | `/api/v1/cases` | Simple, visible, operationally easy. |
| Media type versioning | `application/vnd.company.case.v1+json` | More REST-pure but operationally heavier. |
| Header versioning | `X-API-Version: 1` | Less visible; avoid unless gateway/platform standard. |

The agent **MUST NOT** invent versioning style inside a random endpoint.

### 9.4 Charset policy

JSON is UTF-8 by standard practice in modern HTTP APIs. The agent **MUST NOT** manually transcode strings unless required.

Rules:

1. Do not assume platform default charset.
2. Use `StandardCharsets.UTF_8` for manual byte conversion.
3. For multipart text parts, respect the part charset where available.
4. Do not corrupt Unicode identifiers/names/descriptions.

---

## 10. Error handling and exception mapping standards

### 10.1 Centralized exception mapping

The API **MUST** map exceptions consistently through `ExceptionMapper` or equivalent centralized mechanism.

Allowed:

```java
@Provider
public final class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Override
    public Response toResponse(DomainException exception) {
        ProblemResponse problem = ProblemResponse.of(
                "https://api.example.com/problems/domain-rule-violation",
                "Domain rule violation",
                exception.safeMessage(),
                Response.Status.CONFLICT.getStatusCode()
        );

        return Response.status(Response.Status.CONFLICT)
                .type("application/problem+json")
                .entity(problem)
                .build();
    }
}
```

Forbidden:

```java
@POST
public Response create(CreateCaseRequest request) {
    try {
        return Response.ok(service.create(request)).build();
    } catch (Exception e) {
        return Response.status(500).entity(e.getMessage()).build(); // FORBIDDEN
    }
}
```

### 10.2 Error response format

Preferred format for modern APIs: RFC 9457 Problem Details.

Required fields:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid fields.",
  "instance": "/cases"
}
```

Allowed extensions:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid fields.",
  "instance": "/cases",
  "errors": [
    { "field": "title", "message": "must not be blank" }
  ],
  "correlationId": "01HXYZ..."
}
```

Rules:

1. Error body **MUST** be machine-readable.
2. Error body **MUST** include correlation/request ID when available.
3. Error body **MUST NOT** include stack traces.
4. Error body **MUST NOT** include SQL, class names, package names, internal service URLs, filesystem paths, secrets, tokens, or PII.
5. `detail` **MUST** be client-safe.
6. Validation errors **SHOULD** identify fields/pointers where safe.
7. Domain conflicts **SHOULD** use `409 Conflict`.
8. Authentication failure **MUST** use `401` with correct auth challenge when applicable.
9. Authorization failure **MUST** use `403` or `404` according to resource disclosure policy.

### 10.3 Exception mapping table

| Exception category | HTTP status | Notes |
|---|---:|---|
| Malformed JSON/body | 400 | Invalid syntax or unreadable entity. |
| Bean validation failure | 400 | Client submitted invalid input. |
| Path/query parameter conversion failure | 400 or 404 | Follow runtime behavior; standardize mapper where possible. |
| Missing resource | 404 | Avoid revealing existence when not authorized. |
| Unsupported media type | 415 | Wrong `Content-Type`. |
| Not acceptable | 406 | Cannot produce requested `Accept`. |
| Domain rule conflict | 409 | Current state prevents operation. |
| Optimistic lock / version conflict | 409 or 412 | Use 412 when conditional headers fail. |
| Duplicate idempotency key with different payload | 409 | Include safe problem details. |
| Rate limit | 429 | Include `Retry-After` if applicable. |
| External dependency timeout | 504 or 503 | Depends on gateway/service role. |
| Unexpected exception | 500 | Log internally; return generic problem. |

### 10.4 Do not throw generic web exceptions from deep layers

Application/domain layers **MUST NOT** depend on JAX-RS exceptions.

Forbidden in service/domain:

```java
throw new NotFoundException("case not found");
```

Allowed:

```java
throw new CaseNotFoundException(caseId);
```

Map at boundary:

```java
@Provider
public final class CaseNotFoundMapper implements ExceptionMapper<CaseNotFoundException> {
    @Override
    public Response toResponse(CaseNotFoundException exception) {
        return Response.status(Response.Status.NOT_FOUND)
                .type("application/problem+json")
                .entity(ProblemResponse.notFound("Case not found"))
                .build();
    }
}
```

### 10.5 Mapper specificity

Rules:

1. Prefer specific mappers for domain exception families.
2. Keep one catch-all `Throwable`/`Exception` mapper only for final safety.
3. Catch-all mapper **MUST** log server-side details and return generic client-safe body.
4. Do not allow catch-all mapper to swallow framework security exceptions incorrectly.
5. Mapper ordering/selection **MUST** be tested for critical exceptions.

---

## 11. Filters and interceptors standards

### 11.1 Use filters for metadata, not business logic

Filters are allowed for:

1. Correlation/request ID.
2. Authentication token extraction.
3. Authorization gate only when policy is infrastructure-level.
4. CORS when not handled by gateway/container.
5. Security headers.
6. Request/response logging metadata.
7. Metrics/tracing.
8. Compression/encryption if architecture requires it.

Filters **MUST NOT**:

1. Implement business workflows.
2. Modify request bodies arbitrarily.
3. Hide validation errors.
4. Perform database writes except audit/logging through safe async pipeline.
5. Swallow exceptions and return success.
6. Read full request/response bodies for logging.

### 11.2 Name binding

Use `@NameBinding` for endpoint-specific filters.

Allowed:

```java
@NameBinding
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireCaseOfficer {
}
```

```java
@Provider
@RequireCaseOfficer
public final class CaseOfficerAuthorizationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext context) {
        // authorization check
    }
}
```

```java
@RequireCaseOfficer
@PUT
@Path("/{caseId}/assignment")
public Response assign(...) { ... }
```

Rules:

1. Use global filters only for truly global behavior.
2. Use name binding for selective behavior.
3. Binding annotations **MUST** be named by policy intent, not implementation.
4. Filters **MUST** be deterministic and side-effect limited.

### 11.3 Logging filter rules

Allowed log fields:

1. Correlation ID.
2. HTTP method.
3. Path template, not raw path when path contains sensitive IDs if policy requires masking.
4. Response status.
5. Duration.
6. Authenticated principal ID if policy allows.
7. Client/app ID.
8. Error type.

Forbidden log fields:

1. Passwords.
2. Tokens.
3. Authorization headers.
4. Cookies.
5. Full request/response bodies by default.
6. File contents.
7. Full PII payloads.
8. Stack traces in client response.

Example:

```java
@Provider
public final class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    public static final String HEADER = "X-Correlation-Id";
    private static final String PROPERTY = "correlationId";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String correlationId = firstHeaderOrGenerate(requestContext, HEADER);
        requestContext.setProperty(PROPERTY, correlationId);
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        Object correlationId = requestContext.getProperty(PROPERTY);
        if (correlationId instanceof String value) {
            responseContext.getHeaders().putSingle(HEADER, value);
        }
    }

    private static String firstHeaderOrGenerate(ContainerRequestContext context, String header) {
        String value = context.getHeaderString(header);
        return value == null || value.isBlank() ? UUID.randomUUID().toString() : value;
    }
}
```

If Java baseline is Java 11, replace pattern matching `instanceof` with classic casting.

### 11.4 Entity interceptors

Entity interceptors are allowed only for representation-level behavior:

1. Compression.
2. Encryption/decryption.
3. Checksums/signatures.
4. Format-level transformations.

They **MUST NOT** perform business validation or domain mutation.

---

## 12. Providers and entity mapping standards

### 12.1 Message body providers

Custom `MessageBodyReader` / `MessageBodyWriter` providers are allowed only when standard JSON/XML/binary providers are insufficient.

Allowed use cases:

1. Custom CSV representation.
2. Domain-specific media type.
3. Streaming format.
4. Backward-compatible legacy wire format.

Forbidden use cases:

1. Bypassing DTO validation.
2. Hiding incompatible API versions.
3. Parsing arbitrary Java serialized objects.
4. Implementing business logic during deserialization.

### 12.2 JSON provider configuration

The project **MUST** standardize JSON provider behavior:

1. Unknown properties: reject or ignore.
2. Null serialization policy.
3. Date/time format.
4. Enum format.
5. Record support if Java 17+.
6. BigDecimal precision handling.
7. Property naming convention.
8. Polymorphism policy.

The agent **MUST NOT** add endpoint-local JSON hacks unless required by a compatibility contract.

### 12.3 Polymorphic JSON rule

Polymorphic deserialization is dangerous and **MUST** be explicitly approved.

Forbidden:

```json
{
  "@class": "com.example.internal.AdminCommand",
  "...": "..."
}
```

Allowed safer model:

```json
{
  "type": "approve",
  "reason": "..."
}
```

Then map through an allow-list:

```java
public CaseTransitionCommand toCommand() {
    return switch (type) {
        case "approve" -> new ApproveCaseCommand(reason);
        case "reject" -> new RejectCaseCommand(reason);
        default -> throw new InvalidTransitionTypeException(type);
    };
}
```

For Java 11, use classic `switch` statement.

---

## 13. Security standards

### 13.1 Endpoint-level access control

Every non-public endpoint **MUST** have an authorization decision.

The agent **MUST** answer:

1. Who can call this endpoint?
2. Which resource ownership/scope check applies?
3. Is the check global, resource-specific, or domain-state-specific?
4. Is authorization enforced before expensive work?
5. What status is returned on denied access?

Forbidden:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) {
    return mapper.toResponse(caseService.get(CaseId.parse(caseId))); // no access check anywhere
}
```

Allowed:

```java
@GET
@Path("/{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId,
                        @Context SecurityContext securityContext) {
    Principal principal = requirePrincipal(securityContext);
    CaseDetails details = caseService.getVisibleCase(principal.getName(), CaseId.parse(caseId));
    return mapper.toResponse(details);
}
```

Or through a verified security interceptor/filter with method/resource-level policy.

### 13.2 Never trust client-provided identity fields

Forbidden:

```java
public final class ApproveCaseRequest {
    public String approverUserId; // FORBIDDEN if used as acting user.
}
```

Allowed:

```java
@PUT
@Path("/{caseId}/approval")
public Response approve(@PathParam("caseId") String caseId,
                        @Valid ApproveCaseRequest request,
                        @Context SecurityContext securityContext) {
    Actor actor = Actor.from(securityContext);
    caseService.approve(actor, CaseId.parse(caseId), request.toCommand());
    return Response.noContent().build();
}
```

The client may send target user IDs only when the operation explicitly acts on another user and authorization checks allow it.

### 13.3 HTTP method allow-list

The API **MUST** reject unsupported methods.

Rules:

1. Only expose methods explicitly annotated.
2. Do not route all methods to generic action handler.
3. Ensure gateway/container does not allow method override bypass unless explicitly required and secured.
4. If method override headers are allowed, validate them through allow-list.

### 13.4 Header handling

Rules:

1. Treat all headers as untrusted input.
2. Do not log `Authorization`, `Cookie`, API keys, or token-bearing headers.
3. Validate `X-Forwarded-*` only if set by trusted gateway.
4. Do not use raw `Host` header for security decisions unless gateway-normalized.
5. Use correlation IDs safely; reject/normalize overly long values.
6. Do not reflect arbitrary headers into responses.

### 13.5 CORS

CORS **MUST** be configured by allow-list.

Forbidden:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Rules:

1. Allow only known origins.
2. Allow only required methods.
3. Allow only required headers.
4. Do not enable credentials with wildcard origin.
5. Prefer gateway/container CORS standardization.
6. Test preflight behavior.

### 13.6 CSRF

For cookie-authenticated browser-facing APIs, CSRF protection **MUST** exist.

For bearer-token APIs where tokens are not automatically attached by browsers, CSRF risk is different but still consider browser storage and CORS policy.

The agent **MUST NOT** assume “REST means no CSRF”.

### 13.7 File upload security

Rules:

1. Enforce maximum file size at gateway/container and application level.
2. Validate content type but do not trust it alone.
3. Validate extension by allow-list if extension matters.
4. Normalize and sanitize filenames.
5. Never write using raw client filename as filesystem path.
6. Store outside executable web roots.
7. Scan for malware if business/security requires.
8. Do not read entire file into memory.
9. Do not log file content.
10. Require authorization before processing upload.

---

## 14. Multipart standards

### 14.1 Multipart support is version/runtime-sensitive

Jakarta REST 3.1 introduced standard multipart media type support. Older JAX-RS implementations often use implementation-specific multipart APIs.

Rules:

1. The agent **MUST** check the project runtime before using `EntityPart`.
2. Do not mix Jersey/RESTEasy-specific multipart APIs unless the project already standardizes on that runtime.
3. Do not convert large parts to `String` unless size is strictly bounded.
4. Prefer `InputStream`/`EntityPart` for file content.
5. Access headers through `EntityPart` when part headers are needed.

Allowed:

```java
@POST
@Path("/{caseId}/attachments")
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(@PathParam("caseId") String caseId,
                       @FormParam("file") EntityPart filePart,
                       @FormParam("description") String description) throws IOException {
    try (InputStream input = filePart.getContent()) {
        AttachmentId attachmentId = attachmentService.upload(
                CaseId.parse(caseId),
                UploadAttachmentCommand.from(filePart.getFileName(), filePart.getMediaType(), description, input)
        );
        return Response.status(Response.Status.CREATED)
                .entity(new UploadAttachmentResponse(attachmentId.value()))
                .build();
    }
}
```

Rules:

1. If `EntityPart#getFileName()` returns optional/nullable depending on version, handle absence safely.
2. Validate part names.
3. Validate media type.
4. Bound part size.
5. Close streams.
6. Do not keep stream beyond request unless explicitly transferred to managed storage.

---

## 15. Client API standards

### 15.1 Client lifecycle

JAX-RS `Client` instances are expensive enough that lifecycle must be deliberate.

Rules:

1. Do not create a new `Client` per request unless for short-lived tool/test code.
2. Create/configure clients centrally.
3. Close clients on application shutdown.
4. Configure timeouts.
5. Register providers/filters explicitly.
6. Use TLS and hostname verification.
7. Do not log secrets.

Forbidden:

```java
public ExternalCaseResponse call(String id) {
    Client client = ClientBuilder.newClient(); // FORBIDDEN per call
    return client.target(baseUrl).path(id).request().get(ExternalCaseResponse.class);
}
```

Allowed:

```java
@ApplicationScoped
public final class ExternalCaseGateway implements AutoCloseable {

    private final Client client;
    private final WebTarget baseTarget;

    @Inject
    public ExternalCaseGateway(ExternalCaseClientConfig config) {
        this.client = ClientBuilder.newBuilder()
                .connectTimeout(config.connectTimeout().toMillis(), TimeUnit.MILLISECONDS)
                .readTimeout(config.readTimeout().toMillis(), TimeUnit.MILLISECONDS)
                .register(ClientCorrelationIdFilter.class)
                .build();
        this.baseTarget = client.target(config.baseUri());
    }

    public ExternalCaseResponse get(String id) {
        return baseTarget.path("cases")
                .path(id)
                .request(MediaType.APPLICATION_JSON_TYPE)
                .get(ExternalCaseResponse.class);
    }

    @Override
    public void close() {
        client.close();
    }
}
```

### 15.2 Timeout rule

Every outbound client **MUST** define:

1. Connection timeout.
2. Read/request timeout.
3. Retry policy if any.
4. Circuit breaker/bulkhead policy if architecture supports it.
5. Maximum response size if applicable.

Do not rely on infinite defaults.

### 15.3 Retry rule

Retries **MUST** respect HTTP method idempotency.

Allowed retry candidates:

1. `GET`, `HEAD`, `OPTIONS`.
2. `PUT`/`DELETE` when domain operation is idempotent.
3. `POST` only with idempotency key or proven idempotent operation.

Forbidden:

```java
// FORBIDDEN: blind retry of non-idempotent POST.
retry(() -> target.path("payments").request().post(Entity.json(payment)));
```

### 15.4 Response handling

Do not ignore response statuses.

Forbidden:

```java
return target.request().get(MyDto.class); // forbidden for integrations needing error mapping
```

Allowed:

```java
try (Response response = target.request(MediaType.APPLICATION_JSON_TYPE).get()) {
    int status = response.getStatus();
    if (status == 200) {
        return response.readEntity(MyDto.class);
    }
    if (status == 404) {
        throw new ExternalCaseNotFoundException(id);
    }
    throw ExternalServiceException.from(status, safeErrorBody(response));
}
```

Rules:

1. Close `Response` when using manual response handling.
2. Map external errors to gateway exceptions.
3. Do not leak external error bodies directly to clients.
4. Read error bodies with size limits.
5. Preserve correlation IDs where appropriate.

### 15.5 URI building

Use `WebTarget`, `UriBuilder`, `path`, `resolveTemplate`, and `queryParam` rather than string concatenation.

Allowed:

```java
return baseTarget.path("cases")
        .path("{caseId}")
        .resolveTemplate("caseId", caseId)
        .queryParam("include", "attachments")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get(CaseResponse.class);
```

Forbidden:

```java
String url = baseUrl + "/cases/" + caseId + "?include=" + include; // FORBIDDEN
```

---

## 16. Asynchronous processing standards

### 16.1 Async is not magic performance

JAX-RS supports asynchronous processing, but async code **MUST** be justified.

Allowed use cases:

1. Long-running server operations that should release request threads.
2. SSE/event streaming.
3. Fan-out client calls with bounded concurrency.
4. Integration calls where non-blocking/reactive client is standardized.

Forbidden use cases:

1. Wrapping blocking code in async without bounding executor.
2. Fire-and-forget writes without durable queue/outbox.
3. Losing security/correlation context.
4. Returning success before operation is durable when contract says completed.

### 16.2 `202 Accepted` rule

Use `202 Accepted` only when the operation is accepted but not completed.

Required response:

1. Operation/job ID.
2. Status URI.
3. Current state.
4. Optional `Retry-After`.

Example:

```java
@POST
@Path("/exports")
public Response requestExport(@Valid CreateExportRequest request, @Context UriInfo uriInfo) {
    ExportJobId jobId = exportService.requestExport(request.toCommand());
    URI statusUri = uriInfo.getAbsolutePathBuilder().path(jobId.value()).build();

    return Response.accepted(new CreateExportResponse(jobId.value(), "accepted", statusUri.toString()))
            .location(statusUri)
            .build();
}
```

Do not return `202` if the operation actually completed synchronously.

### 16.3 CompletionStage client rule

`CompletionStage` client APIs are allowed when:

1. The project has an async composition policy.
2. Timeouts are enforced.
3. Exceptions are mapped.
4. Executor behavior is understood.
5. Backpressure/bulkhead exists for fan-out.

Forbidden:

```java
// FORBIDDEN: unbounded fan-out.
ids.forEach(id -> client.target(base).path(id).request().rx().get(String.class));
```

Allowed pattern:

```java
List<CompletionStage<ExternalCaseResponse>> calls = ids.stream()
        .limit(maxFanOut)
        .map(this::getCaseAsync)
        .toList();
```

For Java 11, replace `.toList()` with `collect(Collectors.toUnmodifiableList())` or project standard.

---

## 17. Server-Sent Events standards

SSE is allowed for one-way server-to-client event streams.

Rules:

1. Use `text/event-stream`.
2. Authenticate before opening the stream.
3. Enforce connection limits.
4. Send keepalive/comment events if required by infrastructure.
5. Include event IDs if clients need resume behavior.
6. Do not send sensitive data to unauthorized subscribers.
7. Close sinks on completion/error.
8. Handle backpressure/disconnects.
9. Do not use SSE for bidirectional command processing.

Example:

```java
@GET
@Path("/{caseId}/events")
@Produces(MediaType.SERVER_SENT_EVENTS)
public void streamCaseEvents(@PathParam("caseId") String caseId,
                             @Context SseEventSink sink,
                             @Context Sse sse,
                             @Context SecurityContext securityContext) {
    Actor actor = Actor.from(securityContext);
    caseEventStreamService.subscribe(actor, CaseId.parse(caseId), event -> {
        OutboundSseEvent outbound = sse.newEventBuilder()
                .id(event.id())
                .name(event.type())
                .mediaType(MediaType.APPLICATION_JSON_TYPE)
                .data(CaseEventResponse.class, mapper.toResponse(event))
                .build();
        sink.send(outbound);
    });
}
```

This is a shape example; actual implementation must handle lifecycle, completion, errors, and cancellation.

---

## 18. Caching, ETag, and preconditions

### 18.1 Cache headers

GET responses **SHOULD** declare cache behavior.

Sensitive/private data:

```java
CacheControl cacheControl = new CacheControl();
cacheControl.setNoStore(true);
return Response.ok(response)
        .cacheControl(cacheControl)
        .build();
```

Public immutable data:

```java
CacheControl cacheControl = new CacheControl();
cacheControl.setMaxAge(3600);
return Response.ok(response)
        .cacheControl(cacheControl)
        .build();
```

Rules:

1. Do not let sensitive data be cached accidentally.
2. Use `ETag`/`Last-Modified` for cache validation where useful.
3. Include `Vary` when content negotiation depends on headers such as `Accept-Language` or `Accept`.
4. Avoid incorrect caching on personalized responses.

### 18.2 Lost update protection

For updates to versioned resources, use one of:

1. `If-Match` + ETag.
2. Explicit version field in request DTO.
3. Domain-level optimistic lock.

Allowed ETag pattern:

```java
@PUT
@Path("/{caseId}")
public Response update(@PathParam("caseId") String caseId,
                       @HeaderParam(HttpHeaders.IF_MATCH) String ifMatch,
                       @Valid UpdateCaseRequest request) {
    Version expectedVersion = ETagParser.parseRequired(ifMatch);
    caseService.update(CaseId.parse(caseId), expectedVersion, request.toCommand());
    return Response.noContent().build();
}
```

Rules:

1. Missing required precondition **SHOULD** return 428 if your API standard uses it.
2. Failed precondition **MUST** return 412.
3. Domain conflict without precondition semantics **SHOULD** return 409.

---

## 19. Transaction and consistency standards

### 19.1 Resource method transaction rule

Resource methods **SHOULD NOT** be transaction scripts unless project architecture explicitly uses that style.

Preferred:

```java
@POST
public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
    CaseId id = caseService.create(request.toCommand());
    return createdResponse(id, uriInfo);
}
```

Transactional boundary inside service:

```java
public final class CaseApplicationService {

    @Transactional
    public CaseId create(CreateCaseCommand command) {
        // validate, persist, publish outbox event
    }
}
```

Rules:

1. Transaction boundaries belong in application service/use case layer.
2. Resource method must not coordinate multiple repositories directly.
3. Do not perform remote calls inside DB transaction unless explicitly designed.
4. Use outbox/inbox for reliable event publication.
5. For multi-step workflows, expose state transitions explicitly.

### 19.2 Idempotency standards

For non-idempotent operations that may be retried by clients or infrastructure:

1. Accept `Idempotency-Key`.
2. Bind key to authenticated actor + endpoint + payload hash.
3. Store result or operation reference.
4. Return same result for same key/payload.
5. Return conflict for same key/different payload.
6. Expire keys according to business policy.

Example shape:

```java
@POST
public Response submit(@HeaderParam("Idempotency-Key") String idempotencyKey,
                       @Valid SubmitCaseRequest request,
                       @Context SecurityContext securityContext) {
    Actor actor = Actor.from(securityContext);
    SubmitCaseResult result = caseService.submit(
            actor,
            IdempotencyKey.required(idempotencyKey),
            request.toCommand()
    );
    return Response.ok(mapper.toResponse(result)).build();
}
```

---

## 20. Observability standards

### 20.1 Required telemetry

Every endpoint **SHOULD** emit:

1. HTTP method.
2. Route template.
3. Status code.
4. Duration.
5. Error category.
6. Correlation/request ID.
7. Authenticated client/app ID if allowed.
8. Payload size buckets where useful.
9. Downstream dependency timing.
10. Retry/circuit-breaker outcomes.

### 20.2 Route template vs raw URI

Prefer route templates for metrics:

```text
GET /cases/{caseId} -> 200 in 32ms
```

Avoid raw high-cardinality metrics:

```text
GET /cases/CASE-2026-000001 -> 200 in 32ms
GET /cases/CASE-2026-000002 -> 200 in 29ms
```

### 20.3 Error logging

Rules:

1. Log unexpected exceptions once at boundary.
2. Include correlation ID.
3. Include safe domain identifiers only if allowed.
4. Do not log request body by default.
5. Do not log secrets/PII.
6. Do not return log-only details to clients.

---

## 21. Testing standards

### 21.1 Resource tests are contract tests

Every resource method **MUST** have tests for:

1. Success status.
2. Response body shape.
3. `Content-Type` / `Accept` behavior.
4. Validation failure.
5. Authorization failure if applicable.
6. Not found/conflict paths.
7. Exception mapper behavior.
8. Query/path parameter conversion.
9. Boundary pagination/sort/filter behavior.
10. Headers such as `Location`, `ETag`, `Cache-Control`, `Retry-After` when used.

### 21.2 Test pyramid

| Test type | Purpose |
|---|---|
| Unit test for mapper/DTO/domain parser | Fast verification of boundary conversion. |
| Resource test | Verify JAX-RS annotations, validation, status, media type. |
| Exception mapper test | Verify safe error contract. |
| Integration test | Verify runtime provider, JSON config, filters, auth, DI. |
| Contract test | Verify public API compatibility. |
| Security test | Verify authz, method allow-list, CORS, no sensitive error leakage. |

### 21.3 Required negative tests

At minimum:

1. Invalid JSON returns 400.
2. Missing required field returns 400.
3. Invalid path ID returns 400 or 404 according to policy.
4. Unknown enum returns 400.
5. Unsupported `Content-Type` returns 415.
6. Unsupported `Accept` returns 406.
7. Missing auth returns 401.
8. Insufficient permission returns 403 or 404 according to policy.
9. Domain conflict returns 409.
10. Unexpected exception returns 500 with generic body and correlation ID.

### 21.4 Golden response examples

For public APIs, keep example request/response files:

```text
src/test/resources/contracts/cases/create-case.request.json
src/test/resources/contracts/cases/create-case.response.201.json
src/test/resources/contracts/cases/create-case.validation-error.400.json
```

The agent **MUST** update examples when changing response contract.

---

## 22. Anti-patterns

### 22.1 Action tunnel endpoint

Forbidden:

```java
@POST
@Path("/action")
public Response action(ActionRequest request) {
    switch (request.action()) {
        case "create": ...
        case "delete": ...
        case "approve": ...
        default: ...
    }
}
```

Why forbidden:

1. Breaks HTTP semantics.
2. Weakens authorization.
3. Hides API contract.
4. Makes observability vague.
5. Makes validation action-dependent and brittle.

### 22.2 God resource

Symptoms:

1. One class has 20+ endpoints across unrelated resources.
2. Injects many services/repositories.
3. Contains workflow logic.
4. Has private helper methods longer than public methods.
5. Has many unrelated DTO mappings.

Fix:

1. Split by resource/sub-resource.
2. Move business logic to application services.
3. Extract mappers.
4. Centralize exception mapping.

### 22.3 Leaky persistence endpoint

Forbidden:

```java
@GET
public List<CaseEntity> list() {
    return repository.findAll();
}
```

Fix:

```java
@GET
public CaseSearchResponse list(@BeanParam @Valid CaseSearchParams params) {
    Page<CaseSummary> page = caseService.search(params.toQuery());
    return mapper.toSearchResponse(page);
}
```

### 22.4 Stringly typed everything

Forbidden:

```java
public Response transition(String caseId, String status, String action, String userType) { ... }
```

Fix:

```java
public Response transition(@PathParam("caseId") String rawCaseId,
                           @Valid TransitionCaseRequest request,
                           @Context SecurityContext securityContext) {
    CaseId caseId = CaseId.parse(rawCaseId);
    Actor actor = Actor.from(securityContext);
    caseService.transition(actor, caseId, request.toCommand());
    return Response.noContent().build();
}
```

### 22.5 Exception-as-control-flow in resource

Forbidden:

```java
try {
    service.update(command);
    return Response.ok().build();
} catch (IllegalArgumentException e) {
    return Response.status(400).entity(e.getMessage()).build();
} catch (RuntimeException e) {
    return Response.status(500).entity(e.getMessage()).build();
}
```

Fix with typed domain exceptions and mappers.

### 22.6 Returning `200 OK` for everything

Forbidden:

```java
return Response.ok(new ApiResponse("ERROR", "not found")).build();
```

Correct:

```java
return Response.status(Response.Status.NOT_FOUND)
        .type("application/problem+json")
        .entity(ProblemResponse.notFound("Case not found"))
        .build();
```

---

## 23. LLM implementation checklist

Before writing or changing JAX-RS code, the agent **MUST** answer:

```text
1. Which namespace is the project using: javax.ws.rs or jakarta.ws.rs?
2. Which Jakarta/JAX-RS version and Java baseline apply?
3. Which runtime/provider is used: Jersey, RESTEasy, CXF, Liberty, Payara, Quarkus, custom container?
4. Is the endpoint public/internal/admin/system-to-system?
5. What resource does the path represent?
6. What HTTP method semantics apply?
7. Is the operation safe/idempotent/retriable?
8. What request DTO/params are accepted?
9. What validation applies?
10. What service/use case is called?
11. What response status/body/headers are returned?
12. What exception mapper handles known failures?
13. What authorization rule applies?
14. What tests must be added/updated?
15. Are docs/examples/contracts affected?
```

If the answer is unknown, the agent **MUST NOT** invent architecture. It must follow existing project conventions or create the smallest safe adapter and document assumptions.

---

## 24. Code generation contract for LLM agents

When asked to implement JAX-RS/Jakarta REST code, the agent **MUST** follow this contract:

```text
You are implementing Java REST code using JAX-RS/Jakarta REST.

You MUST:
- obey the project's Java baseline;
- use exactly one namespace: javax.ws.rs OR jakarta.ws.rs;
- keep resource classes thin;
- use resource-oriented paths;
- preserve HTTP method semantics;
- declare @Consumes and @Produces;
- use named request/response DTOs;
- validate boundary input;
- map DTOs to application commands/queries;
- return correct HTTP status codes and headers;
- use centralized ExceptionMapper for errors;
- avoid returning persistence/domain entities;
- enforce authorization or call out where it exists;
- avoid request state in resource fields;
- configure client timeouts for outbound calls;
- avoid blind retries of non-idempotent operations;
- add/update tests for success and failure contract.

You MUST NOT:
- mix javax.ws.rs and jakarta.ws.rs;
- implement business logic in resource classes;
- mutate state through GET;
- accept Map<String,Object> for normal JSON APIs;
- return 200 OK for errors;
- leak stack traces or internal errors;
- expose JPA entities;
- concatenate URLs manually;
- create a JAX-RS Client per request;
- read large upload/download payloads fully into memory;
- log secrets, tokens, cookies, or full sensitive payloads;
- introduce runtime-specific APIs unless the project already standardizes on them.
```

---

## 25. Reviewer checklist

A reviewer **MUST** reject a JAX-RS change if any of these are true:

1. `javax.ws.rs` and `jakarta.ws.rs` are mixed.
2. A `GET` endpoint performs intended mutation.
3. Resource method contains business workflow logic.
4. Endpoint accepts raw `Map<String, Object>` without strong reason.
5. Endpoint returns JPA/domain entity directly.
6. `@Consumes`/`@Produces` are missing for non-trivial endpoints.
7. Status codes are wrong or everything returns 200.
8. Creation endpoint omits `201 Created`/`Location` without reason.
9. Update/delete endpoint returns body/status inconsistently with contract.
10. Validation is missing for request DTO/path/query params.
11. Authorization is missing or assumed to be handled somewhere vague.
12. Exceptions are caught inline and returned as strings.
13. Error body leaks internals.
14. Multipart upload loads large file into memory.
15. JAX-RS client has no timeout.
16. JAX-RS client is created per request.
17. Retry policy ignores idempotency.
18. Logs include tokens, cookies, passwords, or full sensitive payloads.
19. Tests do not cover error paths.
20. API examples/contracts are stale.

---

## 26. Source references

This standard was prepared using the following primary or authoritative references:

1. Jakarta RESTful Web Services specification index: https://jakarta.ee/specifications/restful-ws/
2. Jakarta RESTful Web Services 4.0 specification: https://jakarta.ee/specifications/restful-ws/4.0/
3. Jakarta RESTful Web Services 4.0 specification document: https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0
4. Jakarta RESTful Web Services 4.0 API Javadocs: https://jakarta.ee/specifications/restful-ws/4.0/apidocs/
5. Jakarta RESTful Web Services 3.1 specification: https://jakarta.ee/specifications/restful-ws/3.1/
6. JSR 370: Java API for RESTful Web Services 2.1: https://jcp.org/en/jsr/detail?id=370
7. Jakarta EE Platform 11: https://jakarta.ee/specifications/platform/11/
8. Jakarta EE Web Profile 11: https://jakarta.ee/specifications/webprofile/11/
9. RFC 9110 HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
10. RFC 9457 Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/rfc9457/
11. OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
