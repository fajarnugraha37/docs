# learn-jaxrs-advanced-part-003.md

# Bagian 003 — Resource Class Mental Model: Class-Level Path, Method-Level Path, Subresource, Lifecycle, dan Boundary Design

> Target pembaca: Java/Jakarta engineer yang ingin menguasai resource model JAX-RS/Jakarta REST secara mendalam. Fokus part ini bukan hanya “pakai `@Path` di class dan method”, tetapi memahami **resource class sebagai HTTP boundary object**, bagaimana runtime membuat instance, melakukan injection, memilih method, memproses subresource, dan bagaimana mendesain resource agar tidak menjadi God class.
>
> Namespace utama: `jakarta.ws.rs.*`. Untuk legacy, mapping `javax.ws.rs.*` tetap dibahas.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Resource Class adalah HTTP Boundary, Bukan Service Layer](#2-mental-model-resource-class-adalah-http-boundary-bukan-service-layer)
3. [Terminologi Resmi: Resource Class, Root Resource Class, Resource Method, Subresource](#3-terminologi-resmi-resource-class-root-resource-class-resource-method-subresource)
4. [Resource Class Minimal](#4-resource-class-minimal)
5. [Class-Level `@Path`](#5-class-level-path)
6. [Method-Level `@Path`](#6-method-level-path)
7. [HTTP Method Designator: `@GET`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`](#7-http-method-designator-get-post-put-patch-delete)
8. [Resource Method vs Normal Java Method](#8-resource-method-vs-normal-java-method)
9. [Effective Resource Path Composition](#9-effective-resource-path-composition)
10. [Method tanpa Method-Level `@Path`](#10-method-tanpa-method-level-path)
11. [Multiple Resource Methods dalam Satu Resource Class](#11-multiple-resource-methods-dalam-satu-resource-class)
12. [Resource Class sebagai Collection Resource](#12-resource-class-sebagai-collection-resource)
13. [Resource Class sebagai Item Resource](#13-resource-class-sebagai-item-resource)
14. [Collection + Item dalam Satu Class: Kapan Oke, Kapan Tidak](#14-collection--item-dalam-satu-class-kapan-oke-kapan-tidak)
15. [Subresource Method](#15-subresource-method)
16. [Subresource Locator](#16-subresource-locator)
17. [Subresource Locator Returning Instance vs Class](#17-subresource-locator-returning-instance-vs-class)
18. [Dynamic Dispatch dan Polymorphic Subresources](#18-dynamic-dispatch-dan-polymorphic-subresources)
19. [Subresource Locator Design Patterns](#19-subresource-locator-design-patterns)
20. [Subresource Locator Failure Modes](#20-subresource-locator-failure-modes)
21. [Resource Lifecycle: Default Per-Request](#21-resource-lifecycle-default-per-request)
22. [Constructor Injection dan JAX-RS Parameter Injection](#22-constructor-injection-dan-jax-rs-parameter-injection)
23. [Field/Bean Property Injection dan Lifecycle Constraints](#23-fieldbean-property-injection-dan-lifecycle-constraints)
24. [CDI Scope vs JAX-RS Lifecycle](#24-cdi-scope-vs-jax-rs-lifecycle)
25. [Singleton Resource: Thread Safety dan State Leakage](#25-singleton-resource-thread-safety-dan-state-leakage)
26. [Request State: Local Variable, Context, atau Field?](#26-request-state-local-variable-context-atau-field)
27. [Resource Class dan Dependency Injection](#27-resource-class-dan-dependency-injection)
28. [Thin Resource Principle](#28-thin-resource-principle)
29. [Resource-Service-Mapper Pattern](#29-resource-service-mapper-pattern)
30. [DTO Boundary: Jangan Expose Entity Langsung](#30-dto-boundary-jangan-expose-entity-langsung)
31. [Resource Naming dan Package Structure](#31-resource-naming-dan-package-structure)
32. [Resource Method Return Type Strategy](#32-resource-method-return-type-strategy)
33. [Resource Method Parameter Strategy](#33-resource-method-parameter-strategy)
34. [Resource Class untuk Workflow / State Transition](#34-resource-class-untuk-workflow--state-transition)
35. [Resource Class untuk Long-Running Operation](#35-resource-class-untuk-long-running-operation)
36. [Resource Class untuk Search dan Query](#36-resource-class-untuk-search-dan-query)
37. [Resource Class untuk Admin/Internal API](#37-resource-class-untuk-admininternal-api)
38. [Testing Resource Class](#38-testing-resource-class)
39. [Observability dari Resource Layer](#39-observability-dari-resource-layer)
40. [Common Failure Modes](#40-common-failure-modes)
41. [Best Practices](#41-best-practices)
42. [Anti-Patterns](#42-anti-patterns)
43. [Production Checklist](#43-production-checklist)
44. [Latihan](#44-latihan)
45. [Referensi Resmi](#45-referensi-resmi)
46. [Penutup](#46-penutup)

---

# 1. Tujuan Part Ini

Part ini menjawab pertanyaan:

```text
Apa sebenarnya resource class dalam JAX-RS?
Bagaimana class-level @Path dan method-level @Path membentuk resource tree?
Kapan method disebut resource method, subresource method, atau subresource locator?
Bagaimana lifecycle resource class?
Apa bahaya menyimpan state di field?
Bagaimana resource class seharusnya berhubungan dengan service/domain layer?
```

## 1.1 Kenapa ini penting?

Banyak JAX-RS codebase terlihat sederhana di awal:

```java
@Path("/orders")
public class OrderResource {
    @GET
    public List<Order> list() { ... }
}
```

Lalu setelah beberapa tahun berubah menjadi:

```text
OrderResource.java
  3000 lines
  50 endpoints
  DB queries
  transaction logic
  business rules
  JSON mapping
  external API call
  audit logic
  retry logic
  file handling
  security checks
```

Itu bukan resource class lagi.

Itu God class.

## 1.2 Resource class yang baik

Resource class yang baik adalah:

```text
thin HTTP adapter
```

Ia mengurus:

- HTTP method;
- URI path;
- request DTO;
- request metadata;
- validation trigger;
- calling application service;
- mapping result to response;
- setting response status/headers.

Ia tidak mengurus seluruh business process.

## 1.3 Prinsip utama

```text
Resource class is the edge of your application, not the center of your domain.
```

---

# 2. Mental Model: Resource Class adalah HTTP Boundary, Bukan Service Layer

Resource class adalah object yang menghubungkan dunia HTTP dengan dunia aplikasi.

```text
HTTP world
  method, URI, headers, body, cookies, status
        ↓
Resource class
        ↓
Application/domain world
  command, query, service, transaction, policy, repository
```

## 2.1 Resource class sebagai adapter

Dalam hexagonal architecture:

```text
JAX-RS Resource = inbound adapter
```

Ia menerima protocol-specific input dan menerjemahkannya menjadi application-specific command/query.

## 2.2 Bad mental model

```text
Resource class = service
```

Ini menyebabkan resource berisi logic berlebihan.

## 2.3 Better mental model

```text
Resource class = protocol boundary
Service = use case boundary
Domain = business rules
Repository/Client = outbound adapter
```

## 2.4 Example boundary flow

```text
POST /orders
  ↓
OrderResource.create(CreateOrderRequest)
  ↓
OrderRestMapper.toCommand()
  ↓
OrderApplicationService.create(command)
  ↓
CreatedOrder result
  ↓
OrderRestMapper.toResponse()
  ↓
201 Created + Location + JSON response
```

## 2.5 Resource should know HTTP

It is okay for resource to know:

- status code;
- headers;
- URI building;
- media type;
- request context.

## 2.6 Domain should not know HTTP

Domain should not depend on:

- `Response`;
- `UriInfo`;
- `HttpHeaders`;
- `SecurityContext`;
- `@PathParam`;
- `WebApplicationException`.

## 2.7 Why separation matters

It enables:

- unit testing use cases without HTTP;
- switching transport later;
- cleaner error mapping;
- easier OpenAPI/contract docs;
- migration between frameworks/runtimes;
- avoiding entity serialization leak.

---

# 3. Terminologi Resmi: Resource Class, Root Resource Class, Resource Method, Subresource

## 3.1 Resource class

A Java class that uses JAX-RS annotations to implement a corresponding web resource.

## 3.2 Root resource class

A resource class annotated with:

```java
@Path
```

Root resource classes provide roots of the resource class tree.

## 3.3 Request method designator

Annotation annotated with `@HttpMethod`.

JAX-RS defines:

```java
@GET
@POST
@PUT
@DELETE
@PATCH
@HEAD
@OPTIONS
```

## 3.4 Resource method

A method annotated with request method designator.

Example:

```java
@GET
public CustomerResponse get() { ... }
```

## 3.5 Subresource method

A method with `@Path` and request method designator.

Example:

```java
@GET
@Path("/{id}/addresses")
public List<AddressResponse> addresses(...) { ... }
```

## 3.6 Subresource locator

A method with `@Path` but without request method designator.

Example:

```java
@Path("/{id}/orders")
public OrderSubResource orders(@PathParam("id") String customerId) {
    return new OrderSubResource(customerId);
}
```

It returns object/class that handles remaining request path.

## 3.7 Provider

Extension type such as mapper/filter/body reader.

## 3.8 Why terminology matters

When debugging matching, lifecycle, injection, and subresources, these categories behave differently.

---

# 4. Resource Class Minimal

## 4.1 Basic code

```java
package com.example.customer.boundary;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/customers")
public class CustomerResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public List<CustomerResponse> list() {
        return List.of();
    }
}
```

## 4.2 What makes it resource class?

It uses JAX-RS annotations.

Because class has `@Path`, it is a root resource class.

Because method has `@GET`, it is a resource method.

## 4.3 Effective path

If application path is:

```java
@ApplicationPath("/api")
```

then:

```text
GET /api/customers
```

## 4.4 Hidden runtime behavior

Runtime:

1. finds root resource class;
2. matches `/customers`;
3. selects method with `@GET`;
4. selects writer for `List<CustomerResponse>`;
5. serializes response.

## 4.5 Simple does not mean simplistic

Even minimal resource participates in:

- matching;
- provider resolution;
- lifecycle;
- serialization;
- content negotiation;
- error mapping.

---

# 5. Class-Level `@Path`

Class-level `@Path` defines root URI template for resource class.

## 5.1 Example

```java
@Path("/customers")
public class CustomerResource { ... }
```

## 5.2 Path as URI template

Can include variables:

```java
@Path("/customers/{customerId}")
public class CustomerItemResource { ... }
```

## 5.3 Collection root

```java
@Path("/customers")
```

usually represents customer collection.

## 5.4 Item root

```java
@Path("/customers/{customerId}")
```

represents specific customer.

## 5.5 Regex

```java
@Path("/customers/{customerId:[A-Z0-9]+}")
```

Use carefully.

## 5.6 Leading slash

Both forms commonly used:

```java
@Path("/customers")
@Path("customers")
```

Spec path is relative URI template. Prefer consistent style in team.

## 5.7 Avoid verbs

Bad:

```java
@Path("/getCustomers")
```

Better:

```java
@Path("/customers")
```

## 5.8 Class-level `@Path` should be stable

Changing it is breaking API.

## 5.9 Naming

Class name should reflect resource boundary:

```java
CustomerResource
CustomerOrdersResource
OrderSubmissionResource
ReportJobResource
```

---

# 6. Method-Level `@Path`

Method-level `@Path` appends to class-level `@Path`.

## 6.1 Example

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/{id}")
    public CustomerResponse get(@PathParam("id") String id) { ... }
}
```

Effective:

```text
GET /customers/{id}
```

## 6.2 Method with no `@Path`

```java
@GET
public List<CustomerResponse> list() { ... }
```

Effective:

```text
GET /customers
```

## 6.3 Method path can be nested

```java
@GET
@Path("/{id}/addresses")
public List<AddressResponse> addresses(...) { ... }
```

## 6.4 Too much nesting warning

Deep path:

```text
/customers/{id}/orders/{orderId}/items/{itemId}/discounts/{discountId}
```

Can become hard to maintain.

Use subresources or separate resources if needed.

## 6.5 Resource design question

Does nested resource truly belong to parent?

Example:

```text
/customers/{id}/orders
```

OK if listing orders for customer.

But order itself may also have canonical URI:

```text
/orders/{orderId}
```

## 6.6 Method-level `@Path` can create subresource method

When combined with HTTP method designator.

```java
@GET
@Path("/{id}")
```

## 6.7 Method-level `@Path` without HTTP method = subresource locator

```java
@Path("/{id}/orders")
public OrderSubResource orders(...) { ... }
```

---

# 7. HTTP Method Designator: `@GET`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`

## 7.1 Request method designator

JAX-RS defines method annotations corresponding to HTTP methods:

```java
@GET
@POST
@PUT
@PATCH
@DELETE
@HEAD
@OPTIONS
```

## 7.2 Resource method

A method with request method designator is a resource method.

```java
@GET
public Response get() { ... }
```

## 7.3 Custom method designator

You can define custom HTTP method annotation using `@HttpMethod`.

Example concept:

```java
@Target(METHOD)
@Retention(RUNTIME)
@HttpMethod("PURGE")
public @interface PURGE {}
```

Rare. Use only when needed.

## 7.4 HTTP semantics first

Do not choose annotation by convenience.

Choose based on semantics:

- `GET`: retrieve.
- `POST`: create/process command.
- `PUT`: replace.
- `PATCH`: partial modify.
- `DELETE`: delete/remove.

## 7.5 `HEAD` and `OPTIONS`

Runtime may handle automatically in some cases.

But explicit handling may be useful for metadata/capability/CORS.

## 7.6 Top-tier rule

```text
HTTP method annotation is part of external contract, not implementation detail.
```

---

# 8. Resource Method vs Normal Java Method

A resource method is not just normal method.

It is invoked by runtime under HTTP semantics.

## 8.1 Runtime-supplied parameters

```java
public Response get(
    @PathParam("id") String id,
    @Context UriInfo uriInfo,
    @HeaderParam("If-Match") String ifMatch
)
```

Runtime supplies these.

## 8.2 Entity parameter

A method can have unannotated entity parameter:

```java
public Response create(CreateCustomerRequest request)
```

Runtime reads request body into object using `MessageBodyReader`.

## 8.3 Invocation constraints

Resource methods must be invokable by runtime.

Avoid weird overloads/ambiguous methods.

## 8.4 Return value

Return value is transformed into HTTP response via `Response` or `MessageBodyWriter`.

## 8.5 Exceptions

Exceptions go through JAX-RS exception handling pipeline.

## 8.6 Threading

Method runs on request processing thread/context.

Async changes this.

## 8.7 Transaction/security

May be intercepted by CDI/Jakarta Transactions/Security depending annotations/runtime.

## 8.8 Testing

Direct unit test is useful but not enough.

Runtime test needed for injection/provider/mapping.

---

# 9. Effective Resource Path Composition

Effective path:

```text
context root
+ application path
+ class @Path
+ method @Path
```

## 9.1 Example

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/{id}")
    public CustomerResponse get(@PathParam("id") String id) { ... }
}
```

If context root:

```text
/licensing
```

Effective:

```text
/licensing/api/customers/{id}
```

## 9.2 Class path variable

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @GET
    public CustomerResponse get(@PathParam("customerId") String id) { ... }

    @GET
    @Path("/orders")
    public List<OrderResponse> orders(@PathParam("customerId") String id) { ... }
}
```

Effective:

```text
GET /customers/{customerId}
GET /customers/{customerId}/orders
```

## 9.3 Same path different methods

```java
@GET
@Path("/{id}")
public CustomerResponse get(...)

@PUT
@Path("/{id}")
public Response replace(...)
```

Same URI, different method semantics.

## 9.4 Same method different media

```java
@POST
@Consumes("application/json")
public Response createJson(...)

@POST
@Consumes("text/csv")
public Response createCsv(...)
```

Possible but use carefully.

## 9.5 Debug formula

When endpoint fails:

```text
What is the final path after all prefixes?
```

---

# 10. Method tanpa Method-Level `@Path`

Method with HTTP method but no method-level `@Path` handles class-level resource.

## 10.1 Collection example

```java
@Path("/customers")
public class CustomerResource {

    @GET
    public List<CustomerResponse> list() { ... }

    @POST
    public Response create(CreateCustomerRequest request) { ... }
}
```

Paths:

```text
GET /customers
POST /customers
```

## 10.2 Item example

```java
@Path("/customers/{id}")
public class CustomerItemResource {

    @GET
    public CustomerResponse get(...) { ... }

    @PUT
    public Response replace(...) { ... }

    @DELETE
    public Response delete(...) { ... }
}
```

Paths:

```text
GET /customers/{id}
PUT /customers/{id}
DELETE /customers/{id}
```

## 10.3 Design style

Two common styles:

1. One class for collection and item.
2. Separate collection and item classes.

## 10.4 Collection + item in one class

```java
@Path("/customers")
public class CustomerResource {
    @GET
    public List<CustomerResponse> list() { ... }

    @POST
    public Response create(...) { ... }

    @GET
    @Path("/{id}")
    public CustomerResponse get(...) { ... }
}
```

OK for small resources.

## 10.5 Separate classes

```java
@Path("/customers")
public class CustomerCollectionResource { ... }

@Path("/customers/{id}")
public class CustomerItemResource { ... }
```

Better when item logic grows.

---

# 11. Multiple Resource Methods dalam Satu Resource Class

A resource class can hold multiple methods.

## 11.1 Typical collection resource

```java
@Path("/orders")
public class OrderResource {

    @GET
    public List<OrderSummaryResponse> list(...) { ... }

    @POST
    public Response create(...) { ... }

    @GET
    @Path("/{id}")
    public OrderDetailResponse get(...) { ... }

    @PATCH
    @Path("/{id}")
    public Response patch(...) { ... }

    @DELETE
    @Path("/{id}")
    public Response delete(...) { ... }
}
```

## 11.2 When OK

Good if:

- cohesive around one resource;
- method count manageable;
- resource stays thin;
- service layer handles complexity.

## 11.3 When split

Split when:

- file too large;
- nested resources complex;
- security differs greatly;
- providers/filters differ;
- OpenAPI grouping unclear;
- methods represent different bounded contexts.

## 11.4 Possible split

```text
OrderCollectionResource
OrderItemResource
OrderCancellationResource
OrderAttachmentResource
OrderSearchResource
```

## 11.5 Avoid artificial split

Do not create too many tiny classes without design reason.

## 11.6 Cohesion metric

Ask:

```text
Would a reader expect these methods to change for same reason?
```

If no, split.

---

# 12. Resource Class sebagai Collection Resource

Collection resource represents set of resources.

Example:

```text
/customers
```

## 12.1 Common methods

```java
@GET  // list/search
@POST // create subordinate resource
```

## 12.2 Example

```java
@Path("/customers")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CustomerCollectionResource {

    @Inject CustomerApplicationService service;
    @Inject CustomerRestMapper mapper;

    @GET
    public CustomerPageResponse list(@BeanParam CustomerQueryParams query) {
        return mapper.toPage(service.search(mapper.toQuery(query)));
    }

    @POST
    public Response create(@Valid CreateCustomerRequest request, @Context UriInfo uriInfo) {
        CreatedCustomer created = service.create(mapper.toCommand(request));

        URI location = uriInfo.getAbsolutePathBuilder()
            .path(created.id())
            .build();

        return Response.created(location)
            .entity(mapper.toResponse(created))
            .build();
    }
}
```

## 12.3 Collection responsibilities

- pagination;
- filtering;
- sorting;
- create subordinate resource;
- collection-level metadata.

## 12.4 Avoid unbounded list

Every collection GET should have pagination/limit.

## 12.5 Creation response

Use `201 Created` with `Location`.

## 12.6 Search

Simple search can be query params.

Complex search may be:

```http
POST /customers/search
```

## 12.7 Collection anti-pattern

```http
GET /customers/all
```

with no limit.

---

# 13. Resource Class sebagai Item Resource

Item resource represents specific resource.

Example:

```text
/customers/{id}
```

## 13.1 Common methods

```java
@GET
@PUT
@PATCH
@DELETE
```

## 13.2 Example

```java
@Path("/customers/{customerId}")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CustomerItemResource {

    @Inject CustomerApplicationService service;
    @Inject CustomerRestMapper mapper;

    @GET
    public Response get(@PathParam("customerId") CustomerId id, @Context Request request) {
        CustomerDetail detail = service.get(id);
        EntityTag etag = new EntityTag(detail.version());

        Response.ResponseBuilder preconditions = request.evaluatePreconditions(etag);
        if (preconditions != null) {
            return preconditions.tag(etag).build();
        }

        return Response.ok(mapper.toResponse(detail))
            .tag(etag)
            .build();
    }

    @PUT
    public Response replace(
        @PathParam("customerId") CustomerId id,
        @HeaderParam("If-Match") String ifMatch,
        @Valid ReplaceCustomerRequest request
    ) {
        service.replace(id, mapper.toCommand(request), ifMatch);
        return Response.noContent().build();
    }

    @DELETE
    public Response delete(@PathParam("customerId") CustomerId id) {
        service.delete(id);
        return Response.noContent().build();
    }
}
```

## 13.3 Item responsibilities

- retrieve detail;
- replace;
- patch;
- delete;
- conditional requests;
- item-specific links/metadata.

## 13.4 Use value object IDs

```java
@PathParam("customerId") CustomerId id
```

with `ParamConverter`.

But do not perform database lookup in converter.

## 13.5 ETag

Item resources commonly benefit from ETag.

## 13.6 Authorization

Item resource often needs data-level authorization.

---

# 14. Collection + Item dalam Satu Class: Kapan Oke, Kapan Tidak

## 14.1 Combined style

```java
@Path("/customers")
public class CustomerResource {
    @GET
    public Page list() { ... }

    @POST
    public Response create(...) { ... }

    @GET
    @Path("/{id}")
    public Customer get(...) { ... }

    @PUT
    @Path("/{id}")
    public Response update(...) { ... }
}
```

## 14.2 Pros

- simple;
- easy to navigate for small domain;
- less classes.

## 14.3 Cons

- can grow huge;
- collection and item concerns mix;
- security and filters can differ;
- harder to test;
- harder OpenAPI grouping.

## 14.4 Separate style

```java
@Path("/customers")
public class CustomerCollectionResource { ... }

@Path("/customers/{customerId}")
public class CustomerItemResource { ... }
```

## 14.5 Pros

- clearer responsibilities;
- smaller files;
- easier lifecycle/security;
- cleaner tests.

## 14.6 Cons

- more classes;
- path duplication;
- possible inconsistent naming.

## 14.7 Recommendation

Start combined for small resources if team prefers.

Split when:

```text
class exceeds cohesive boundary
```

not based purely on line count.

---

# 15. Subresource Method

A subresource method is method with `@Path` and HTTP method designator.

## 15.1 Example

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/{customerId}/orders")
    public List<OrderResponse> orders(@PathParam("customerId") String customerId) {
        return service.orders(customerId);
    }
}
```

This directly handles:

```text
GET /customers/{customerId}/orders
```

## 15.2 Difference from subresource locator

Subresource method handles request directly.

Subresource locator returns another object/class to continue matching.

## 15.3 When use subresource method

Use when nested endpoint is simple and cohesive.

## 15.4 When avoid

Avoid if subresource has many operations.

Example:

```text
/customers/{customerId}/orders
GET
POST
/customers/{customerId}/orders/{orderId}
GET
PATCH
DELETE
```

This may deserve separate resource class.

## 15.5 Method path composition

Class path + method path.

## 15.6 Path params

Both class-level and method-level path params can be injected.

```java
@GET
@Path("/{orderId}")
public OrderResponse get(
    @PathParam("customerId") String customerId,
    @PathParam("orderId") String orderId
)
```

## 15.7 Common bug

Duplicated param name in nested path causing confusing binding.

Prefer distinct names.

---

# 16. Subresource Locator

A subresource locator is method with `@Path` but without HTTP method designator.

## 16.1 Example

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @Path("/orders")
    public CustomerOrdersResource orders(@PathParam("customerId") String customerId) {
        return new CustomerOrdersResource(customerId);
    }
}
```

Subresource:

```java
public class CustomerOrdersResource {

    private final String customerId;

    public CustomerOrdersResource(String customerId) {
        this.customerId = customerId;
    }

    @GET
    public List<OrderResponse> list() { ... }

    @POST
    public Response create(CreateOrderRequest request) { ... }
}
```

## 16.2 Request flow

Request:

```http
GET /customers/C001/orders
```

Runtime:

```text
match CustomerResource /customers/{customerId}
  ↓
invoke orders("C001")
  ↓
returned CustomerOrdersResource
  ↓
match @GET on returned object
```

## 16.3 Why use it?

- nested resource grouping;
- share parent context;
- dynamic polymorphism;
- reuse subresource classes;
- avoid huge parent resource.

## 16.4 Why avoid it?

- lifecycle/injection subtlety;
- harder to understand;
- runtime dispatch less obvious;
- manual `new` can bypass CDI;
- tests more complex.

## 16.5 Locator method can have params

```java
@Path("/orders")
public CustomerOrdersResource orders(
    @PathParam("customerId") String customerId,
    @Context SecurityContext security
) { ... }
```

## 16.6 Locator can return object or class

Important difference.

We cover next.

---

# 17. Subresource Locator Returning Instance vs Class

This is subtle and important.

## 17.1 Returning instance

```java
@Path("/orders")
public CustomerOrdersResource orders(@PathParam("customerId") String customerId) {
    return new CustomerOrdersResource(customerId);
}
```

You created the instance.

Runtime dispatches to it, but lifecycle/injection is not the same as normal runtime-created resource.

## 17.2 Injection issue

If subresource has:

```java
@Inject OrderService service;
```

and you manually call `new`, CDI injection may not happen.

## 17.3 Returning class

```java
@Path("/orders")
public Class<CustomerOrdersResource> orders() {
    return CustomerOrdersResource.class;
}
```

Runtime can manage lifecycle.

But how to pass `customerId`?

You can inject path param in subresource:

```java
public class CustomerOrdersResource {

    @PathParam("customerId")
    String customerId;

    @Inject
    OrderService service;
}
```

This depends on runtime lifecycle and injection rules.

## 17.4 Official nuance

Objects returned by subresource locator are expected to be initialized by their creator. If you return class, runtime manages the resource instance/lifecycle.

## 17.5 CDI-friendly pattern

Instead of `new`, use `ResourceContext`:

```java
@Context
ResourceContext resourceContext;

@Path("/orders")
public CustomerOrdersResource orders() {
    return resourceContext.getResource(CustomerOrdersResource.class);
}
```

Then subresource can receive injection.

## 17.6 Or use CDI programmatic lookup

```java
@Inject
Instance<CustomerOrdersResource> ordersResource;

@Path("/orders")
public CustomerOrdersResource orders(@PathParam("customerId") String customerId) {
    CustomerOrdersResource resource = ordersResource.get();
    resource.setCustomerId(customerId);
    return resource;
}
```

Be careful with mutable state/scope.

## 17.7 Recommendation

For most apps:

```text
Prefer normal root resources or subresource methods.
Use subresource locators only when they materially improve design.
```

If using locators, decide lifecycle/injection explicitly.

---

# 18. Dynamic Dispatch dan Polymorphic Subresources

Subresource locator can return different object types at runtime.

## 18.1 Example

```java
@Path("/documents/{id}")
public class DocumentResource {

    @Path("/content")
    public Object content(@PathParam("id") String id) {
        Document doc = service.get(id);

        return switch (doc.type()) {
            case PDF -> new PdfContentResource(doc);
            case IMAGE -> new ImageContentResource(doc);
            case TEXT -> new TextContentResource(doc);
        };
    }
}
```

Runtime inspects returned object to continue matching.

## 18.2 Use cases

- resource type differs by domain state;
- plugin architecture;
- role-specific subresource;
- polymorphic document/content handling.

## 18.3 Risks

- hard to reason;
- hard to document OpenAPI;
- hard to test;
- injection/lifecycle issues;
- surprising behavior.

## 18.4 Prefer explicit design

If possible, expose explicit resource types:

```text
/documents/{id}/pdf-content
/documents/{id}/image-content
```

or return representation that tells client available links.

## 18.5 Top-tier rule

Use dynamic subresource dispatch only when it reduces real complexity, not as cleverness.

---

# 19. Subresource Locator Design Patterns

## 19.1 Parent context pattern

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @Path("/orders")
    public CustomerOrdersResource orders(@PathParam("customerId") CustomerId customerId) {
        return new CustomerOrdersResource(customerId, orderService);
    }
}
```

Use to pass parent ID.

Caution: manual construction.

## 19.2 ResourceContext pattern

```java
@Path("/orders")
public CustomerOrdersResource orders() {
    return resourceContext.getResource(CustomerOrdersResource.class);
}
```

Use runtime-managed resource.

## 19.3 Class-return pattern

```java
@Path("/orders")
public Class<CustomerOrdersResource> orders() {
    return CustomerOrdersResource.class;
}
```

Simpler lifecycle, but context passing via params/injection.

## 19.4 Nested module pattern

Parent resource delegates whole subtree.

```text
/customers/{id}/orders/...
```

## 19.5 Capability pattern

Subresource exposes optional capability.

```text
/accounts/{id}/statements
/accounts/{id}/cards
```

## 19.6 Avoid database lookup in locator unless needed

Locator invocation happens before final method.

If locator performs heavy DB lookup for all nested operations, it can be expensive.

## 19.7 Authorization in locator

Parent-level authorization can happen in locator, but be careful:

- not all child actions have same permissions;
- denial mapping must be consistent;
- audit needs action context.

---

# 20. Subresource Locator Failure Modes

## 20.1 Injection missing

Manual `new` bypasses CDI.

## 20.2 State leak

Returned singleton holds parent ID in field.

## 20.3 Heavy DB lookup

Every nested request pays cost before method matching.

## 20.4 OpenAPI missing endpoints

Tooling may not discover dynamic subresources well.

## 20.5 Ambiguous matching

Subresource and method paths overlap.

## 20.6 Authorization too coarse

Parent locator authorizes access to parent but not child operation.

## 20.7 Null return

What happens if locator returns null? Usually request fails. Better throw clear `NotFoundException`.

## 20.8 Dynamic type surprises

Returned object changes by state, causing inconsistent available methods.

## 20.9 Testing gaps

Direct resource tests miss full runtime dispatch.

## 20.10 Recommendation

If subresource locator used, add integration tests for complete nested paths.

---

# 21. Resource Lifecycle: Default Per-Request

Jakarta REST spec says by default a new resource class instance is created for each request to that resource.

Sequence:

```text
constructor
  ↓
dependency/param field injection
  ↓
resource method invocation
  ↓
object eligible for GC
```

## 21.1 Why per-request is nice

You can use fields for request-injected params safely under default lifecycle.

Example:

```java
@Path("/customers/{id}")
public class CustomerResource {

    @PathParam("id")
    String id;

    @GET
    public CustomerResponse get() { ... }
}
```

Because new instance per request.

## 21.2 But be careful

CDI scopes or implementation-specific lifecycles can change this.

## 21.3 Performance

Per-request object creation is usually not performance bottleneck.

Do not prematurely optimize by making singleton.

## 21.4 Lifecycle can be implementation-specific

Spec allows implementation to offer other lifecycles.

CDI integration may affect lifecycle.

## 21.5 Top-tier rule

```text
Know your resource lifecycle before using fields for request state.
```

---

# 22. Constructor Injection dan JAX-RS Parameter Injection

Root resource classes are instantiated by runtime and must have public constructor runtime can satisfy.

## 22.1 Zero-arg constructor

```java
public CustomerResource() {}
```

Always simple.

## 22.2 Constructor with JAX-RS params

```java
public CustomerResource(@Context UriInfo uriInfo) {
    this.uriInfo = uriInfo;
}
```

Spec allows public constructor params annotated with:

- `@Context`;
- `@HeaderParam`;
- `@CookieParam`;
- `@MatrixParam`;
- `@QueryParam`;
- `@PathParam`.

## 22.3 Multiple constructors

If multiple suitable constructors exist, runtime chooses one with most parameters.

Ambiguity with same parameter count is implementation-specific and should warn.

## 22.4 CDI constructor injection

With CDI-managed resources, constructor injection can use `@Inject`.

```java
@Inject
public CustomerResource(CustomerService service) {
    this.service = service;
}
```

But check runtime/CDI integration.

## 22.5 Avoid per-request data in constructor for non-request lifecycle

If singleton/application-scoped, request-specific constructor params make no sense.

## 22.6 Recommendation

Use CDI constructor injection for services if supported.

Use method parameters for request-specific values.

## 22.7 Safe style

```java
@Path("/customers/{id}")
public class CustomerResource {

    private final CustomerService service;

    @Inject
    public CustomerResource(CustomerService service) {
        this.service = service;
    }

    @GET
    public CustomerResponse get(@PathParam("id") CustomerId id) {
        return service.get(id);
    }
}
```

---

# 23. Field/Bean Property Injection dan Lifecycle Constraints

JAX-RS can inject params into fields/properties.

## 23.1 Example

```java
@Path("/customers/{id}")
public class CustomerResource {

    @PathParam("id")
    String id;

    @HeaderParam("If-Match")
    String ifMatch;

    @Context
    UriInfo uriInfo;
}
```

## 23.2 Injection timing

Field/property injection happens when resource instance is created.

## 23.3 Default per-request only

Spec says field/bean property injection for request params is only supported for default per-request lifecycle, except `@Context`.

## 23.4 Why?

If resource singleton, what would `@PathParam("id")` field mean across concurrent requests?

Impossible safely.

## 23.5 Prefer method parameters

Better:

```java
@GET
public CustomerResponse get(@PathParam("id") String id) { ... }
```

Method params make request dependency explicit.

## 23.6 When field injection is okay

- simple per-request resource;
- `@Context` objects;
- small legacy code.

## 23.7 For services

Use CDI injection fields/constructor:

```java
@Inject CustomerService service;
```

Not JAX-RS param injection.

## 23.8 Top-tier recommendation

Use method parameters for request data.

Use constructor injection for dependencies.

---

# 24. CDI Scope vs JAX-RS Lifecycle

CDI introduces scopes.

## 24.1 Common scopes

```java
@RequestScoped
@ApplicationScoped
@Dependent
```

## 24.2 Resource class with `@RequestScoped`

```java
@Path("/customers")
@RequestScoped
public class CustomerResource { ... }
```

Natural fit.

## 24.3 Resource class with `@ApplicationScoped`

```java
@Path("/customers")
@ApplicationScoped
public class CustomerResource { ... }
```

Must be thread-safe.

Do not store request params in fields.

## 24.4 `@Dependent`

Default CDI pseudo-scope.

Lifecycle depends on injection point/owner.

## 24.5 CDI proxies

Normal-scoped beans are often proxied.

May affect final classes/methods depending CDI rules.

## 24.6 Provider scopes

Exception mappers/filters often application-scoped.

Make stateless.

## 24.7 Transaction/security interceptors

If resource/service is CDI-managed, interceptors can apply.

## 24.8 Recommendation

- Resource: `@RequestScoped` or default per-request.
- Service: `@ApplicationScoped`.
- Provider/filter/mapper: `@ApplicationScoped` and stateless.
- Request context holder: `@RequestScoped`.

---

# 25. Singleton Resource: Thread Safety dan State Leakage

Singleton resource has one instance shared by requests.

## 25.1 Example danger

```java
@Path("/customers/{id}")
@Singleton
public class CustomerResource {

    @PathParam("id")
    String id; // dangerous if singleton

    @GET
    public CustomerResponse get() {
        return service.get(id);
    }
}
```

Concurrent requests can overwrite `id`.

## 25.2 Safe singleton

```java
@Path("/health")
@Singleton
public class HealthResource {

    @GET
    public HealthResponse health() {
        return HealthResponse.ok();
    }
}
```

No mutable request state.

## 25.3 Thread-safe dependencies

Injected services must be thread-safe or properly scoped.

## 25.4 Avoid caching request data

No fields like:

```java
currentUser
currentTenant
currentRequest
lastResponse
```

## 25.5 Performance myth

Singleton does not automatically improve performance materially.

Most overhead is IO, DB, JSON, network.

## 25.6 Rule

Use singleton resources only when stateless and deliberately designed.

---

# 26. Request State: Local Variable, Context, atau Field?

## 26.1 Best: method parameter/local variable

```java
@GET
public Response get(@PathParam("id") String id, @Context SecurityContext security) {
    String user = security.getUserPrincipal().getName();
    ...
}
```

## 26.2 Acceptable: request-scoped field

```java
@RequestScoped
public class CustomerResource {
    @PathParam("id")
    String id;
}
```

## 26.3 Dangerous: application-scoped field

```java
@ApplicationScoped
public class CustomerResource {
    String currentUser;
}
```

## 26.4 Context object

Use `@Context` for request metadata.

## 26.5 RequestContext bean

You can create CDI request-scoped context holder:

```java
@RequestScoped
public class RequestMetadata {
    private String correlationId;
    private TenantId tenantId;
}
```

Set via filter.

## 26.6 Avoid ThreadLocal unless necessary

ThreadLocal can break with async/reactive/virtual threads if misused.

Prefer request-scoped CDI/context propagation.

## 26.7 Rule

```text
Request state belongs to request scope or method scope, never singleton mutable field.
```

---

# 27. Resource Class dan Dependency Injection

## 27.1 Inject service

```java
@Inject
CustomerApplicationService service;
```

## 27.2 Constructor injection

Preferred for mandatory dependencies:

```java
private final CustomerApplicationService service;

@Inject
public CustomerResource(CustomerApplicationService service) {
    this.service = service;
}
```

## 27.3 Field injection

Common in Jakarta EE but less explicit.

## 27.4 Avoid service locator

Bad:

```java
CustomerService service = ServiceLocator.get(CustomerService.class);
```

## 27.5 Avoid manual construction

Bad:

```java
private final CustomerService service = new CustomerService();
```

## 27.6 Inject mappers

```java
@Inject CustomerRestMapper mapper;
```

## 27.7 Keep dependencies small

If resource injects 15 services, it likely has too many responsibilities.

## 27.8 Dependency smell

Large resource constructor often means split resource/use case.

---

# 28. Thin Resource Principle

Resource class should be thin.

## 28.1 Good responsibilities

- read path/query/header/body;
- trigger validation;
- get authenticated principal/tenant;
- call application service;
- convert result to response;
- set status/header;
- build URI.

## 28.2 Bad responsibilities

- SQL;
- JPA Criteria;
- transaction orchestration;
- payment API details;
- retry logic;
- business rules;
- domain state machine;
- file parsing;
- JSON manual mapping everywhere;
- message publishing details.

## 28.3 Bad example

```java
@POST
public Response create(CreateOrderRequest request) {
    if (request.items().isEmpty()) { ... }
    EntityTransaction tx = em.getTransaction();
    tx.begin();
    ...
    paymentClient.charge(...);
    em.persist(...);
    tx.commit();
    mail.send(...);
    return Response.ok().build();
}
```

## 28.4 Better

```java
@POST
public Response create(@Valid CreateOrderRequest request, @Context UriInfo uriInfo) {
    CreatedOrder result = orderService.create(mapper.toCommand(request));

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(result.id().value())
        .build();

    return Response.created(location)
        .entity(mapper.toResponse(result))
        .build();
}
```

## 28.5 Why thin matters

- test use case without HTTP;
- resource tests focus HTTP contract;
- easier error mapping;
- easier audit/observability;
- avoids transaction leaks;
- improves maintainability.

## 28.6 Rule of thumb

If method has more than:

```text
parse/map → call service → map response
```

ask whether logic belongs elsewhere.

---

# 29. Resource-Service-Mapper Pattern

A practical production pattern:

```text
Resource
  ↓
RestMapper
  ↓
ApplicationService
  ↓
Domain/Repository
```

## 29.1 Resource

```java
@Path("/orders")
public class OrderResource {
    @Inject OrderApplicationService service;
    @Inject OrderRestMapper mapper;
}
```

## 29.2 Mapper

```java
@ApplicationScoped
public class OrderRestMapper {
    CreateOrderCommand toCommand(CreateOrderRequest request) { ... }
    OrderResponse toResponse(OrderResult result) { ... }
}
```

## 29.3 Service

```java
@ApplicationScoped
public class OrderApplicationService {
    @Transactional
    public CreatedOrder create(CreateOrderCommand command) { ... }
}
```

## 29.4 Benefits

- HTTP DTO separate from domain command.
- Resource remains small.
- Mapping testable.
- Service reusable by other inbound adapters.
- Error mapping centralized.

## 29.5 Mapper caution

Do not put heavy business rules in mapper.

Mapper transforms shape.

## 29.6 Transaction boundary

Usually service, not resource.

## 29.7 Exception boundary

Service throws domain/application exceptions.

ExceptionMapper maps to HTTP.

---

# 30. DTO Boundary: Jangan Expose Entity Langsung

## 30.1 Bad

```java
@GET
public CustomerEntity get(@PathParam("id") String id) {
    return entityManager.find(CustomerEntity.class, id);
}
```

## 30.2 Problems

- exposes internal fields;
- lazy loading issues;
- infinite recursion;
- security leak;
- persistence changes break API;
- JSON provider accidentally serializes relationships;
- versioning hard.

## 30.3 Better

```java
public record CustomerResponse(
    String id,
    String name,
    String status,
    List<LinkResponse> links
) {}
```

## 30.4 Request DTO

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Email String email
) {}
```

## 30.5 Domain command

```java
public record CreateCustomerCommand(
    CustomerName name,
    Email email
) {}
```

## 30.6 Projection

Use query projection for read APIs where needed.

## 30.7 Exception

Small internal tool may expose simple entity temporarily, but document as technical debt.

## 30.8 Rule

```text
Resource representation is an API contract, not a database structure.
```

---

# 31. Resource Naming dan Package Structure

## 31.1 Naming options

```java
CustomerResource
CustomerCollectionResource
CustomerItemResource
CustomerOrdersResource
OrderSubmissionResource
ReportJobResource
```

## 31.2 Package by feature

Recommended:

```text
com.example.customer.boundary.rest
com.example.customer.application
com.example.customer.domain
com.example.customer.infrastructure.persistence
```

## 31.3 Package by layer

Alternative:

```text
com.example.rest
com.example.service
com.example.repository
```

Can become messy in large domain.

## 31.4 Boundary package

Resource classes are boundary/adapters.

Name package accordingly:

```text
boundary.rest
adapter.in.rest
api
web.rest
```

## 31.5 Avoid generic package

```text
controllers
```

is okay if convention, but in JAX-RS “resource” is more precise.

## 31.6 Group by bounded context

For microservice:

```text
licensing.application.boundary.rest
licensing.profile.boundary.rest
```

## 31.7 Top-tier principle

Package structure should tell architecture story.

---

# 32. Resource Method Return Type Strategy

## 32.1 Return DTO directly

```java
@GET
public CustomerResponse get(...) { ... }
```

Pros:

- simple;
- readable;
- less boilerplate.

Cons:

- less control over status/headers.

## 32.2 Return `Response`

```java
@GET
public Response get(...) { ... }
```

Pros:

- status/header/control.

Cons:

- can hide entity type;
- OpenAPI generation may need annotations;
- overused becomes verbose.

## 32.3 Mixed approach

Use DTO for simple `200 OK`.

Use `Response` when controlling:

- `201 Created`;
- `202 Accepted`;
- `204 No Content`;
- `ETag`;
- `Location`;
- `Cache-Control`;
- `Link`;
- conditional request.

## 32.4 GenericEntity

Use when generic type erasure affects writer.

```java
GenericEntity<List<CustomerResponse>> entity =
    new GenericEntity<>(customers) {};
return Response.ok(entity).build();
```

## 32.5 StreamingOutput

Use for streaming large response.

## 32.6 CompletionStage/async

Use for async server patterns carefully.

## 32.7 Rule

Return type should reflect HTTP contract clarity.

---

# 33. Resource Method Parameter Strategy

## 33.1 Explicit params

```java
public Response list(
    @QueryParam("page") @DefaultValue("1") int page,
    @QueryParam("size") @DefaultValue("20") int size
)
```

Good for few params.

## 33.2 `@BeanParam`

Group many params:

```java
public Response list(@BeanParam CustomerQueryParams query)
```

```java
public class CustomerQueryParams {
    @QueryParam("page")
    @DefaultValue("1")
    int page;

    @QueryParam("size")
    @DefaultValue("20")
    int size;

    @QueryParam("status")
    List<String> status;
}
```

## 33.3 Entity body param

```java
public Response create(@Valid CreateCustomerRequest request)
```

## 33.4 Header params

Use for semantic headers:

```java
@HeaderParam("If-Match")
String ifMatch
```

## 33.5 Context params

```java
@Context UriInfo uriInfo
@Context Request request
@Context SecurityContext security
```

## 33.6 Too many params smell

If method has many params, create `@BeanParam` or request DTO.

## 33.7 Domain value object

Use `ParamConverter` for IDs.

```java
@PathParam("customerId") CustomerId id
```

## 33.8 Rule

Parameter list should communicate HTTP contract.

---

# 34. Resource Class untuk Workflow / State Transition

Enterprise APIs often model workflows.

## 34.1 Bad RPC-ish

```http
POST /applications/{id}/submitApplication
```

## 34.2 Better command resource

```http
POST /applications/{id}/submission
```

or:

```http
POST /applications/{id}/actions/submit
```

## 34.3 Resource class

```java
@Path("/applications/{applicationId}/submission")
public class ApplicationSubmissionResource {

    @Inject ApplicationSubmissionService service;

    @POST
    public Response submit(@PathParam("applicationId") ApplicationId id) {
        SubmissionResult result = service.submit(id);
        return Response.status(Status.ACCEPTED)
            .entity(result)
            .build();
    }
}
```

## 34.4 State transition status

Possible:

- `200 OK` if immediate result;
- `202 Accepted` if async;
- `204 No Content` if no body;
- `409 Conflict` if invalid current state;
- `403 Forbidden` if not allowed;
- `412 Precondition Failed` if ETag mismatch.

## 34.5 Idempotency

Repeated submit should be defined.

Maybe:

- return same submitted state;
- reject with conflict;
- require idempotency key.

## 34.6 Audit

Workflow operations require audit.

## 34.7 Rule

Model state transition explicitly; do not hide in generic update.

---

# 35. Resource Class untuk Long-Running Operation

## 35.1 Start job

```java
@Path("/reports")
public class ReportResource {

    @POST
    public Response start(CreateReportRequest request, @Context UriInfo uriInfo) {
        JobId jobId = service.start(request);

        URI jobUri = uriInfo.getBaseUriBuilder()
            .path(ReportJobResource.class)
            .path(ReportJobResource.class, "get")
            .build(jobId.value());

        return Response.accepted()
            .location(jobUri)
            .header("Retry-After", "5")
            .build();
    }
}
```

## 35.2 Job resource

```java
@Path("/reports/jobs/{jobId}")
public class ReportJobResource {

    @GET
    public ReportJobStatusResponse get(@PathParam("jobId") JobId jobId) {
        return service.status(jobId);
    }

    @POST
    @Path("/cancellation")
    public Response cancel(@PathParam("jobId") JobId jobId) {
        service.cancel(jobId);
        return Response.accepted().build();
    }
}
```

## 35.3 Why separate resource?

Because job has its own lifecycle:

- queued;
- running;
- succeeded;
- failed;
- cancelled.

## 35.4 Avoid blocking request

Do not hold HTTP request for minutes unless specific long-poll/SSE design.

## 35.5 Observability

Job ID should appear in logs/metrics/traces.

## 35.6 Rule

Long-running operation should return a resource client can observe.

---

# 36. Resource Class untuk Search dan Query

## 36.1 Simple query

```http
GET /customers?status=ACTIVE&page=1&size=20
```

Resource:

```java
@GET
public CustomerPageResponse search(@BeanParam CustomerQueryParams params) { ... }
```

## 36.2 Complex query

If query is complex and large:

```http
POST /customers/search
Content-Type: application/json
```

## 36.3 Search as resource?

You can model saved search:

```http
POST /customer-searches
GET /customer-searches/{id}/results
```

## 36.4 Pagination required

Never return unbounded results.

## 36.5 Sorting grammar

Define allowed fields.

Do not pass raw SQL field names.

## 36.6 Filtering grammar

Validate filters.

Prevent expensive queries.

## 36.7 Search and HTTP semantics

`POST /search` can be acceptable for complex query processing.

But document cache/idempotency behavior.

## 36.8 Rule

Search endpoint is API contract and query engine boundary; design it deliberately.

---

# 37. Resource Class untuk Admin/Internal API

## 37.1 Separate path

```text
/internal
/admin
```

## 37.2 Separate application?

Maybe:

```java
@ApplicationPath("/internal-api")
public class InternalApiApplication extends Application {}
```

## 37.3 Separate filters

Admin APIs often need:

- mTLS;
- internal auth;
- stricter audit;
- no public CORS;
- IP allowlist/gateway protection.

## 37.4 Response detail

Internal APIs may expose more operational detail, but still avoid secrets.

## 37.5 Resource naming

```java
AdminUserResource
InternalJobResource
OperationalHealthResource
```

## 37.6 Danger

Internal APIs become public accidentally via gateway.

## 37.7 Checklist

- network restriction;
- auth;
- audit;
- docs;
- no secrets;
- clear ownership.

---

# 38. Testing Resource Class

## 38.1 Unit test resource directly

Mock service/mapper.

Test:

- status;
- headers;
- service call;
- response mapping.

## 38.2 Example

```java
@Test
void createReturns201Location() {
    // given
    // when
    Response response = resource.create(request, uriInfo);

    assertEquals(201, response.getStatus());
    assertEquals("/customers/C001", response.getLocation().getPath());
}
```

## 38.3 Runtime test

Need runtime test for:

- `@Path`;
- parameter injection;
- body reader;
- validation;
- exception mapper;
- filters;
- CDI injection.

## 38.4 Contract test

Assert API behavior via HTTP.

## 38.5 Subresource test

Must test full nested URL.

## 38.6 Serialization golden test

Validate JSON shape.

## 38.7 Security test

Test `401`, `403`, data-level authorization.

## 38.8 Failure test

Test service exception mapped correctly.

## 38.9 Testing strategy

```text
Unit test resource logic.
Integration test JAX-RS runtime pipeline.
Contract test external API behavior.
```

---

# 39. Observability dari Resource Layer

Resource layer is best place to enrich request context.

## 39.1 Metrics

Use path template, not raw URI.

Labels:

- method;
- path template;
- status;
- error code;
- tenant category if low-cardinality.

## 39.2 Logs

At boundary:

- operation;
- resource ID if safe;
- correlation ID;
- user/tenant if safe;
- status;
- duration.

## 39.3 Traces

Span name should use template:

```text
GET /customers/{customerId}
```

not:

```text
GET /customers/C001
```

## 39.4 Jakarta REST 4.0 support

`UriInfo#getMatchedResourceTemplate` helps expose matched template.

## 39.5 Error mapping

ExceptionMapper should set error code.

Metrics should categorize by error code/status.

## 39.6 Avoid logging body

Do not log sensitive request/response body.

## 39.7 Resource naming in logs

Use operation names:

```text
CustomerResource.get
OrderSubmissionResource.submit
```

## 39.8 Rule

Resource layer observes HTTP boundary, not domain internals.

---

# 40. Common Failure Modes

## 40.1 Resource not found

`@Path` wrong or app path wrong.

## 40.2 Method not found

HTTP method annotation missing/wrong.

## 40.3 Ambiguous matching

Multiple methods match same path/method/media.

## 40.4 Media mismatch

`@Consumes`/`@Produces` does not match request.

## 40.5 Param injection conversion error

Invalid UUID/int/date.

## 40.6 Field injection in singleton

Request data leaks.

## 40.7 CDI injection null

Manual construction/registration bypassed CDI.

## 40.8 Subresource injection missing

Locator returns `new` instance.

## 40.9 Resource grows huge

Business logic accumulates.

## 40.10 JPA entity serialization failure

Lazy loading/infinite recursion.

## 40.11 Missing ETag/concurrency

Lost updates.

## 40.12 Wrong status codes

Client behavior breaks.

## 40.13 Path duplication

Class/method path causes unexpected final URI.

## 40.14 OpenAPI missing subresources

Dynamic locator not discovered.

---

# 41. Best Practices

## 41.1 Keep resource thin

Map HTTP to service call.

## 41.2 Use DTOs

Request/response DTOs are API contract.

## 41.3 Choose path intentionally

Resource-oriented, stable, understandable.

## 41.4 Use method parameters for request data

Avoid request data fields unless per-request lifecycle clear.

## 41.5 Prefer CDI-managed resources

Let container handle injection/lifecycle.

## 41.6 Use subresource locators sparingly

Only when they improve structure.

## 41.7 Avoid mutable singleton resource state

Stateless only.

## 41.8 Split by cohesion

Large resource class should be split.

## 41.9 Test runtime behavior

Annotations require runtime tests.

## 41.10 Instrument boundary

Metrics/logs/traces with safe labels.

---

# 42. Anti-Patterns

## 42.1 God Resource

Everything in one class.

## 42.2 Resource as transaction script

DB and business logic directly in resource.

## 42.3 Entity as response

Exposes persistence internals.

## 42.4 Manual `new` with CDI dependencies

Injection broken.

## 42.5 Singleton with path fields

Race condition.

## 42.6 Deep nesting

Hard-to-use URI tree.

## 42.7 Dynamic subresource cleverness

Hard to document/test.

## 42.8 Verbs everywhere

```text
/getCustomer
/createOrder
/deleteInvoice
```

## 42.9 `Response` for everything without contract clarity

Hides entity type and docs.

## 42.10 No tests for path matching

Regression-prone.

---

# 43. Production Checklist

## 43.1 Resource design

- [ ] Resource class has clear responsibility.
- [ ] Resource class is not God class.
- [ ] Resource path is stable and resource-oriented.
- [ ] Method semantics align with HTTP.
- [ ] DTOs used at boundary.
- [ ] JPA entities not exposed.

## 43.2 Lifecycle

- [ ] Resource lifecycle understood.
- [ ] No request mutable state in singleton/application scoped resource.
- [ ] CDI injection works.
- [ ] Subresource locator lifecycle tested.
- [ ] Providers/resources thread-safe where shared.

## 43.3 Path/matching

- [ ] Effective path documented.
- [ ] No ambiguous paths.
- [ ] Path params named clearly.
- [ ] Regex path used only when justified.
- [ ] Nested resources not excessive.

## 43.4 Responses

- [ ] Correct status codes.
- [ ] `Location` for `201`/`202`.
- [ ] ETag where needed.
- [ ] Error contract via mapper.
- [ ] Pagination for collections.

## 43.5 Testing

- [ ] Unit tests for resource.
- [ ] Runtime/integration tests for annotations.
- [ ] Contract tests for API.
- [ ] Subresource tests.
- [ ] Security tests.
- [ ] Serialization tests.

## 43.6 Observability

- [ ] Path template metrics.
- [ ] Correlation ID.
- [ ] Trace spans.
- [ ] Error code metrics.
- [ ] Logs redacted.

---

# 44. Latihan

## Latihan 1 — Resource Classification

Ambil 10 endpoint dari project.

Klasifikasikan:

```text
collection resource
item resource
subresource method
subresource locator
command resource
job resource
search resource
```

## Latihan 2 — Split God Resource

Ambil resource class besar.

Split menjadi:

```text
CollectionResource
ItemResource
WorkflowResource
SearchResource
JobResource
```

Jelaskan alasan split.

## Latihan 3 — Lifecycle Experiment

Buat resource dengan field counter.

Uji default per-request vs singleton/application-scoped.

Amati behavior concurrent request.

## Latihan 4 — Subresource Locator Injection

Buat locator yang return `new`.

Tambahkan `@Inject` di subresource.

Lihat failure.

Refactor ke runtime/CDI-managed pattern.

## Latihan 5 — DTO Boundary

Ambil endpoint yang return entity.

Buat response DTO.

Tambahkan mapper.

Test JSON golden output.

## Latihan 6 — Path Design

Desain API untuk:

- submit application;
- approve application;
- cancel order;
- generate report;
- download report;
- list customer orders.

Tentukan resource class dan method.

## Latihan 7 — Observability

Implement metric label using path template.

Pastikan raw ID tidak menjadi label.

---

# 45. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

3. `@Path` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/path

4. `@PathParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/pathparam

5. `ResourceContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/resourcecontext

6. Jersey Documentation — JAX-RS Application, Resources and Sub-Resources  
   https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/jaxrs-resources.html

7. RESTEasy User Guide — Resource Locators and Sub Resources  
   https://docs.resteasy.dev/5.0/userguide/html/ch18.html

8. Jakarta RESTful Web Services Explained  
   https://jakarta.ee/learn/specification-guides/restful-web-services-explained/

9. Jakarta EE Tutorial — RESTful Web Services with Jakarta REST  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

10. Jakarta CDI 4.1  
    https://jakarta.ee/specifications/cdi/4.1/

---

# 46. Penutup

Resource class adalah pusat ekspresi JAX-RS, tetapi bukan pusat business logic.

Mental model utama:

```text
Resource class = HTTP boundary adapter
Resource method = HTTP operation handler
Subresource method = nested operation handler
Subresource locator = runtime continuation to another resource object/class
Application service = use case/business orchestration
Domain = business rules
```

Hal-hal penting:

```text
@Path di class membentuk root resource.
@Path di method + HTTP method membentuk subresource method.
@Path di method tanpa HTTP method membentuk subresource locator.
Default lifecycle resource class adalah per-request.
Manual new pada subresource bisa bypass injection.
Singleton resource harus stateless/thread-safe.
```

Top-tier JAX-RS engineer tidak hanya menaruh endpoint di class. Ia mendesain resource tree, lifecycle, state, injection, DTO boundary, status code, observability, dan testability dengan sadar.

Part berikutnya:

```text
Bagian 004 — Request Matching Algorithm Deep Dive
```

Kita akan membedah bagaimana runtime memilih resource method ketika ada banyak `@Path`, regex, method, media type, subresource, dan ambiguity.
