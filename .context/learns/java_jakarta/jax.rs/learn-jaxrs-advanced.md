# Daftar Isi Besar — Advanced Jakarta/Javax RESTful Web Services / JAX-RS

## Bagian 000 — Big Picture JAX-RS: From Annotation API to HTTP Runtime Contract

Fokus:

* Apa itu JAX-RS/Jakarta REST secara mendalam.
* JAX-RS sebagai **contract antara HTTP request, resource method, entity provider, context, response, dan runtime**.
* Perbedaan REST architectural style vs “HTTP JSON API”.
* `javax.ws.rs` vs `jakarta.ws.rs`.
* JAX-RS 1.x, 2.0, 2.1, Jakarta REST 2.1, 3.0, 3.1, 4.0.
* Kenapa Jakarta REST 4.0 menghapus JAXB dependency dan ManagedBean support.
* Kapan JAX-RS cocok, kapan tidak.
* JAX-RS vs Spring MVC/WebFlux vs Servlet raw vs gRPC vs GraphQL.
* Mental model request pipeline.

## Bagian 001 — HTTP Semantics yang Wajib Dikuasai Sebelum JAX-RS

Fokus:

* Resource, representation, method, status code, header.
* Safe, idempotent, cacheable.
* `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
* Status code families.
* `201 Created`, `202 Accepted`, `204 No Content`, `304 Not Modified`, `400`, `401`, `403`, `404`, `409`, `412`, `415`, `422`, `429`, `500`, `503`.
* Idempotency-key.
* Conditional request: `ETag`, `If-Match`, `If-None-Match`, `Last-Modified`.
* Cache semantics.
* Why many API bugs are actually HTTP semantic bugs.

## Bagian 002 — Anatomy of JAX-RS Application: `Application`, Base Path, Deployment, Runtime

Fokus:

* `jakarta.ws.rs.core.Application`.
* `@ApplicationPath`.
* Resource class discovery.
* Programmatic registration.
* Provider registration.
* WAR deployment.
* Servlet integration.
* Java SE bootstrap clarification.
* Runtime differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus/RESTEasy Reactive contexts.
* Application boundary design.

## Bagian 003 — Resource Class Mental Model: Class-Level Path, Method-Level Path, Subresource

Fokus:

* Resource class sebagai HTTP boundary.
* `@Path` di class dan method.
* Root resource vs subresource.
* Singleton vs per-request resource lifecycle.
* Constructor injection vs field injection.
* Statefulness dangers.
* Resource method design.
* Thin resource, thick service.
* Anti-pattern: domain logic in resource class.

## Bagian 004 — Request Matching Algorithm Deep Dive

Fokus:

* Bagaimana runtime memilih resource method.
* Path template matching.
* Literal vs variable path.
* Regex path segments.
* Ambiguous match.
* Method selection.
* Media type selection.
* Subresource locator.
* Inheritance and overriding.
* Why “endpoint tidak kepanggil” sering terjadi.
* Debugging request matching.

## Bagian 005 — Path Template, Regex, Matrix Param, and URI Design

Fokus:

* `@Path("{id}")`.
* Regex: `@Path("{id:\\d+}")`.
* Multi-segment matching.
* Matrix parameters.
* URI hierarchy.
* Resource identity.
* Nested resource design.
* URI anti-patterns.
* Version in URI vs header.
* Slashes, trailing slash, normalization.

## Bagian 006 — Parameter Injection: `@PathParam`, `@QueryParam`, `@HeaderParam`, `@CookieParam`, `@MatrixParam`

Fokus:

* Parameter injection pipeline.
* Primitive conversion.
* Optional/default values.
* Collection params.
* Repeated query params.
* `@DefaultValue`.
* Header parsing.
* Cookie access.
* Matrix param usage and rarity.
* Error behavior when conversion fails.
* Parameter design patterns.

## Bagian 007 — Advanced Parameter Conversion: `ParamConverter`, `ParamConverterProvider`, `valueOf`, Constructor

Fokus:

* Built-in conversion rules.
* Custom value object conversion.
* `UUID`, `LocalDate`, domain IDs.
* `ParamConverterProvider`.
* Exception and error mapping.
* Conversion vs validation.
* Avoid parsing domain semantics in resource.
* Testing converters.
* Provider ordering and portability.

## Bagian 008 — Context Injection: `@Context`, `UriInfo`, `HttpHeaders`, `Request`, `SecurityContext`

Fokus:

* `@Context` mental model.
* `UriInfo`.
* `HttpHeaders`.
* `Request`.
* `SecurityContext`.
* `ResourceContext`.
* `Configuration`.
* `Application`.
* `Providers`.
* `HttpServletRequest` bridge where available.
* Request-scoped context and thread-safety.
* `UriInfo#getMatchedResourceTemplate` in Jakarta REST 4.0.

## Bagian 009 — Request Entity Binding: Input Entity, Streams, Readers, DTO Boundary

Fokus:

* Request body lifecycle.
* Entity stream.
* JSON binding.
* Form data.
* Text/binary upload.
* One-time stream read.
* DTO design.
* Validation boundary.
* Large payload strategy.
* `InputStream` vs POJO.
* Content-Length and chunked requests.
* Payload limits.

## Bagian 010 — Response Construction: `Response`, `GenericEntity`, Headers, Location, Links

Fokus:

* `Response.ok()`, `created()`, `accepted()`, `noContent()`.
* Entity + status + headers.
* `Location`.
* `Content-Location`.
* `Link`.
* `Cache-Control`.
* `ETag`.
* `Vary`.
* `GenericEntity<T>`.
* Response metadata design.
* Response DTO vs domain entity.
* Avoiding `Response` everywhere vs typed return.

## Bagian 011 — Entity Providers: `MessageBodyReader` and `MessageBodyWriter`

Fokus:

* Provider pipeline.
* Built-in providers.
* Custom readers/writers.
* Type matching.
* Generic type handling.
* Annotation and media type matching.
* Provider priority.
* Streaming output.
* Binary content.
* Error handling.
* Provider portability.

## Bagian 012 — JSON in JAX-RS: JSON-B, JSON-P, Jackson, Provider Selection

Fokus:

* JSON-B as standard Jakarta binding.
* JSON-P for low-level JSON.
* Jackson as implementation/library choice.
* Provider discovery.
* Date/time serialization.
* Records.
* Null handling.
* Unknown fields.
* Polymorphism.
* Security concerns.
* JSON Merge Patch.
* DTO versioning.
* Runtime-specific defaults.

## Bagian 013 — Content Negotiation Deep Dive

Fokus:

* `@Consumes`.
* `@Produces`.
* `Accept`.
* `Content-Type`.
* `Accept-Language`.
* `Accept-Encoding`.
* Quality factor `q`.
* `Variant`.
* `Request.selectVariant`.
* `406 Not Acceptable`.
* `415 Unsupported Media Type`.
* `Vary` header.
* Versioning with media type.
* Debugging negotiation failure.

## Bagian 014 — Error Handling Architecture: Exceptions, Mappers, Problem Details

Fokus:

* `WebApplicationException`.
* `NotFoundException`, `BadRequestException`, etc.
* `ExceptionMapper<T>`.
* Mapper selection hierarchy.
* Domain exception mapping.
* Validation exception mapping.
* Provider exception mapping.
* Stable error contract.
* RFC 7807 / problem details pattern.
* Error codes.
* Correlation ID.
* Avoid leaking stack traces.

## Bagian 015 — Validation Integration: Jakarta Validation at REST Boundary

Fokus:

* `@Valid`.
* Bean Validation on request DTO.
* Parameter validation.
* Return value validation.
* Groups.
* Custom constraints.
* Cross-field validation.
* Mapping `ConstraintViolationException`.
* `400` vs `422`.
* Validation vs business rules.
* Localization.
* Security and validation.

## Bagian 016 — Filters: `ContainerRequestFilter` and `ContainerResponseFilter`

Fokus:

* Filter pipeline.
* Pre-matching vs post-matching.
* `@PreMatching`.
* Header manipulation.
* Authentication preprocessing.
* Correlation ID.
* CORS.
* Request logging.
* Response hardening.
* Abort request.
* Filter ordering.
* Name binding.
* DynamicFeature.
* Async behavior.

## Bagian 017 — Interceptors: `ReaderInterceptor` and `WriterInterceptor`

Fokus:

* Entity stream interception.
* Compression/decompression.
* Encryption/decryption boundary.
* Auditing body metadata.
* Request/response wrapping.
* Stream handling dangers.
* Difference filters vs interceptors.
* Ordering and priorities.
* Use cases and anti-patterns.

## Bagian 018 — Name Binding, DynamicFeature, Priorities, and Provider Lifecycle

Fokus:

* `@NameBinding`.
* `DynamicFeature`.
* `@Priority`.
* Global vs resource-specific filters.
* Provider singleton lifecycle.
* CDI-managed providers.
* Runtime-managed providers.
* Thread safety.
* Ordering pitfalls.
* Debugging provider not registered.

## Bagian 019 — Security in JAX-RS: Authentication, Authorization, Principal, Roles

Fokus:

* JAX-RS security boundary.
* `SecurityContext`.
* `isUserInRole`.
* Container security integration.
* Jakarta Security integration.
* JWT/OIDC bearer token.
* Session/cookie auth.
* Service-to-service auth.
* Method-level security.
* Multi-tenant authorization.
* Data-level authorization.
* Avoiding role-only security.

## Bagian 020 — CORS, CSRF, Cookies, Browser Security, and REST APIs

Fokus:

* CORS mental model.
* Preflight.
* `Access-Control-Allow-Origin`.
* Credentials.
* SameSite cookies.
* CSRF.
* REST API for browser vs machine client.
* Token storage trade-offs.
* Security headers.
* CORS anti-patterns.
* Filter-based implementation.

## Bagian 021 — Pagination, Sorting, Filtering, Search, and Query Contract Design

Fokus:

* Offset pagination.
* Cursor/keyset pagination.
* Sorting grammar.
* Filtering grammar.
* Search endpoint design.
* Index-aware API design.
* `limit` enforcement.
* Stable ordering.
* Total count trade-off.
* Pagination with consistency.
* Error semantics.

## Bagian 022 — PATCH, JSON Patch, JSON Merge Patch, and Partial Update Semantics

Fokus:

* `PATCH` method.
* `application/merge-patch+json`.
* JSON Merge Patch in Jakarta REST 4.0 context.
* JSON Patch vs Merge Patch.
* Null semantics.
* Partial validation.
* Optimistic locking with `If-Match`.
* Auditability.
* Idempotency.
* Domain update strategy.

## Bagian 023 — Conditional Requests, ETag, Last-Modified, Optimistic Concurrency

Fokus:

* `EntityTag`.
* `Request.evaluatePreconditions`.
* `If-Match`.
* `If-None-Match`.
* `If-Modified-Since`.
* `If-Unmodified-Since`.
* `304`.
* `412`.
* ETag strong vs weak.
* HTTP caching and concurrency.
* JPA version integration.
* Distributed cache concerns.

## Bagian 024 — Hypermedia and Links: `Link`, HATEOAS, and Practical REST Maturity

Fokus:

* `jakarta.ws.rs.core.Link`.
* `rel`.
* Pagination links.
* Resource affordances.
* HATEOAS practical value.
* When not to overdo hypermedia.
* OpenAPI vs hypermedia.
* Link headers vs body links.
* Evolvability.

## Bagian 025 — Asynchronous JAX-RS Server: `AsyncResponse`, Timeouts, Cancellation

Fokus:

* `@Suspended AsyncResponse`.
* Long polling.
* Async timeout.
* Cancellation.
* Threading model.
* Managed executor.
* Backpressure.
* Resource cleanup.
* Error mapping.
* Observability.
* Why async server is not automatic scalability.

## Bagian 026 — Server-Sent Events / SSE

Fokus:

* `Sse`, `SseEventSink`.
* Event stream.
* Reconnect.
* Last-Event-ID.
* Heartbeat.
* Backpressure.
* Broadcast.
* Client disconnect.
* Security.
* Scaling multi-node SSE.
* SSE vs WebSocket vs polling.

## Bagian 027 — Streaming Responses: `StreamingOutput`, Chunking, Large Download

Fokus:

* `StreamingOutput`.
* Large file download.
* Range requests.
* `Content-Disposition`.
* `Content-Length` vs chunked.
* Backpressure.
* Stream lifecycle.
* Error after response committed.
* File/object storage streaming.
* Security and path traversal.

## Bagian 028 — Multipart and File Upload

Fokus:

* JAX-RS multipart situation and implementation-specific support.
* Servlet multipart bridge.
* Jersey/RESTEasy multipart providers.
* Upload limits.
* Streaming upload.
* Virus scanning.
* Filename sanitization.
* Content type validation.
* Object storage.
* Metadata and audit.
* Portable vs non-portable APIs.

## Bagian 029 — JAX-RS Client API: Mental Model and Core Usage

Fokus:

* `Client`.
* `ClientBuilder`.
* `WebTarget`.
* `Invocation.Builder`.
* `Entity`.
* Response handling.
* Connection lifecycle.
* Pooling.
* Timeout.
* `try-with-resources`.
* DTO deserialization.
* Client factory design.

## Bagian 030 — Advanced Client API: Filters, Interceptors, Features, Async, SSE Client

Fokus:

* `ClientRequestFilter`.
* `ClientResponseFilter`.
* Client interceptors.
* Auth headers.
* Correlation propagation.
* Retry integration.
* Async invocations.
* `CompletionStage`.
* SSE client.
* Error handling.
* Metrics/tracing.
* Client provider registration.

## Bagian 031 — Client Resilience: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency

Fokus:

* JAX-RS client and network reality.
* Connect/read/request timeout.
* Retry only safe operations.
* Idempotency keys.
* Circuit breaker.
* Bulkhead.
* Rate limiter.
* MicroProfile Fault Tolerance integration.
* Error classification.
* Observability.
* Avoiding retry storms.

## Bagian 032 — CDI Integration and Resource/Provider Injection

Fokus:

* CDI-managed resource classes.
* CDI-managed providers.
* Injection into filters/providers.
* Scope decisions.
* `@ApplicationScoped`, `@RequestScoped`.
* Request context.
* Proxies.
* Circular dependencies.
* Producer patterns.
* Testing.
* Jakarta REST 4.0 removal of ManagedBean support and why CDI matters.

## Bagian 033 — Transactions, Persistence, and REST Boundary

Fokus:

* Transaction boundary in resource/service.
* `@Transactional`.
* EntityManager lifecycle.
* Lazy loading and serialization.
* DTO projection.
* Open Session in View anti-pattern.
* Optimistic locking.
* Idempotent write.
* `201` vs `202`.
* Async processing with outbox.
* REST + JPA failure modes.

## Bagian 034 — API Versioning Strategy

Fokus:

* URI versioning.
* Header versioning.
* Media type versioning.
* Compatibility rules.
* Deprecation.
* Sunset header.
* Rolling upgrade.
* Consumer-driven contract testing.
* Backward/forward compatibility.
* Avoiding version explosion.

## Bagian 035 — OpenAPI and Documentation Strategy

Fokus:

* OpenAPI generation with JAX-RS annotations.
* MicroProfile OpenAPI.
* Annotation vs contract-first.
* DTO examples.
* Error schema.
* Security schema.
* Versioned docs.
* Keeping docs accurate.
* Docs as contract.
* Testing OpenAPI.

## Bagian 036 — Testing JAX-RS Server

Fokus:

* Unit test resource.
* Provider tests.
* ExceptionMapper tests.
* In-memory container.
* JerseyTest/RESTEasy test tools.
* Arquillian.
* Testcontainers.
* Contract tests.
* Golden JSON.
* Security tests.
* Runtime-specific tests.

## Bagian 037 — Testing JAX-RS Client

Fokus:

* Mock server.
* WireMock/MockWebServer.
* Timeout tests.
* Retry tests.
* Error response tests.
* Serialization tests.
* Contract tests.
* TLS/mTLS tests.
* Observability tests.
* Avoid mocking too much.

## Bagian 038 — Implementation Deep Dive: Jersey, RESTEasy, Apache CXF, Open Liberty

Fokus:

* Spec vs implementation.
* Jersey features.
* RESTEasy Classic vs Reactive context.
* Apache CXF.
* Open Liberty Jakarta REST feature.
* Provider defaults.
* JSON provider differences.
* Multipart support differences.
* CDI integration differences.
* Portable core vs vendor extensions.

## Bagian 039 — Migration: `javax.ws.rs` to `jakarta.ws.rs`

Fokus:

* Package migration.
* Dependency migration.
* Generated code.
* Providers.
* Filters/interceptors.
* Client API migration.
* Runtime upgrade.
* Spring Boot 2→3 context.
* Third-party libraries.
* Mixed namespace trap.
* OpenRewrite.
* Testing strategy.

## Bagian 040 — Legacy JAX-RS 2.1 Features: Async, SSE, Reactive Client

Fokus:

* What JAX-RS 2.1 introduced.
* `javax.ws.rs` compatibility.
* `@PATCH`.
* SSE.
* Reactive client.
* CompletionStage.
* Differences in Jakarta REST.
* Maintaining legacy apps.
* Compatibility mapping.

## Bagian 041 — Production Observability for JAX-RS

Fokus:

* Access logs.
* Structured application logs.
* Correlation ID.
* Metrics per endpoint.
* Error mapping metrics.
* Latency histogram.
* Payload size.
* Trace propagation.
* OpenTelemetry instrumentation.
* Redaction.
* Alerting by SLO.

## Bagian 042 — Performance Engineering JAX-RS

Fokus:

* Request matching cost.
* JSON serialization cost.
* Reflection/provider cost.
* Threading model.
* Virtual threads.
* Blocking vs non-blocking.
* DB pool bottleneck.
* Large payload.
* Streaming.
* Compression.
* Benchmarking.
* Profiling.
* P99 mindset.

## Bagian 043 — Production Security Hardening for JAX-RS APIs

Fokus:

* Authentication.
* Authorization.
* Rate limiting.
* CSRF/CORS.
* Input validation.
* Output encoding.
* Error response hardening.
* Sensitive data redaction.
* SSRF through URL params.
* File upload security.
* Deserialization risks.
* API abuse.
* OWASP API Security mindset.

## Bagian 044 — REST API Design for Enterprise Domains

Fokus:

* Resource modeling.
* Commands vs resources.
* Subresources.
* State transitions.
* Long-running operations.
* `202 Accepted`.
* Operation resources.
* Domain-driven API.
* Idempotent command endpoint.
* Auditability.
* Workflow APIs.
* Avoiding CRUD-only thinking.

## Bagian 045 — Long-Running Operations and Async API Design

Fokus:

* `202 Accepted`.
* Job resource.
* Polling.
* SSE notification.
* Callback/webhook.
* Idempotency.
* Cancellation.
* Progress.
* Retry.
* Failure state.
* Batch integration.
* Workflow orchestration.

## Bagian 046 — Error Contract and Enterprise Error Taxonomy

Fokus:

* Technical vs business error.
* Validation vs authorization vs conflict.
* Error code governance.
* Localization.
* Supportability.
* Correlation.
* Problem details.
* Retryable flag.
* Incident triage.
* API client guidance.

## Bagian 047 — Multi-Tenancy and Data Authorization in JAX-RS

Fokus:

* Tenant resolution.
* Path/header/token tenant.
* Tenant spoofing.
* SecurityContext and tenant context.
* Data filtering.
* JPA integration.
* Cache isolation.
* Audit.
* Metrics by tenant without high-cardinality disaster.
* Testing multi-tenant APIs.

## Bagian 048 — API Gateway, Reverse Proxy, Load Balancer, and JAX-RS Apps

Fokus:

* `X-Forwarded-*`.
* Forwarded header.
* Base URI reconstruction.
* HTTPS termination.
* Rate limiting at gateway vs app.
* Auth at gateway vs app.
* CORS at gateway vs app.
* Path rewriting.
* OpenAPI behind gateway.
* Observability and trace propagation.

## Bagian 049 — Advanced HTTP Client and Service-to-Service Communication

Fokus:

* JAX-RS client vs MicroProfile Rest Client.
* DNS.
* connection pooling.
* TLS/mTLS.
* proxy.
* timeout.
* retries.
* circuit breaker.
* client lifecycle.
* typed client pattern.
* generated clients.
* contract testing.

## Bagian 050 — JAX-RS with MicroProfile: Config, Rest Client, Fault Tolerance, Metrics, OpenAPI, JWT

Fokus:

* MicroProfile ecosystem around JAX-RS.
* Config.
* Rest Client.
* Fault Tolerance.
* Metrics.
* Health.
* OpenAPI.
* JWT.
* OpenTelemetry relationship.
* Portable runtime reality.
* When to use Jakarta only vs MicroProfile.

## Bagian 051 — JAX-RS and Jakarta Security / OAuth2 / OIDC / JWT

Fokus:

* Bearer token.
* JWT claims.
* Scope vs role.
* Resource server.
* OIDC integration.
* SecurityContext mapping.
* Method security.
* API key.
* mTLS service identity.
* Token propagation.
* Authorization design.

## Bagian 052 — JAX-RS Runtime Internals and Extension Points

Fokus:

* Runtime bootstrap.
* Provider factory.
* Resource model.
* Dispatcher.
* Matching engine.
* Entity provider registry.
* Filter/interceptor chain.
* Exception mapper selection.
* CDI bridge.
* Servlet bridge.
* Threading.
* Implementation-specific internals.

## Bagian 053 — Building a Production-Grade JAX-RS API from Scratch

Fokus:

* Project structure.
* Resource/service/repository layers.
* DTOs.
* Validation.
* Error contract.
* Security.
* Config.
* Observability.
* Tests.
* OpenAPI.
* Deployment.
* Example end-to-end.

## Bagian 054 — Refactoring Legacy JAX-RS API

Fokus:

* God resource class.
* Entity exposure.
* No error contract.
* No validation.
* No pagination.
* No timeout.
* Mixed `javax`/`jakarta`.
* Tight vendor coupling.
* Refactoring sequence.
* Safety tests.
* Incremental modernization.

## Bagian 055 — Capstone: Top 1% JAX-RS Reference Architecture

Fokus:

* Reference architecture blueprint.
* API governance.
* Coding standards.
* Provider registry.
* Error taxonomy.
* Security policy.
* Observability catalog.
* Testing pyramid.
* Performance baseline.
* Migration checklist.
* Production readiness review.