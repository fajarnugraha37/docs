# learn-jaxrs-advanced-part-021.md

# Bagian 021 — PATCH, JSON Patch, JSON Merge Patch, and Partial Update Semantics: PUT vs PATCH, Null vs Missing, Field Authorization, Validation, Optimistic Locking, Idempotency, Audit, dan Domain State Semantics

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **partial update** REST API secara production-grade. Fokus bagian ini bukan hanya “pakai `@PATCH`”, tetapi memahami PATCH sebagai kontrak perubahan resource: perbedaan PUT/PATCH/POST, patch document media types, JSON Merge Patch, JSON Patch, null vs missing, field-level authorization, validation setelah apply patch, optimistic concurrency, idempotency, audit trail, conflict handling, dan domain semantics.
>
> Namespace utama: `jakarta.ws.rs.PATCH`, `jakarta.ws.rs.Consumes`, `jakarta.ws.rs.core.MediaType`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.core.EntityTag`, `jakarta.ws.rs.core.Request`, `jakarta.json.JsonObject`, `jakarta.json.JsonPatch`, `jakarta.json.JsonMergePatch` jika runtime/API menyediakan JSON-P support, serta provider/library JSON terkait.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: PATCH adalah Change Contract, Bukan DTO Partial Aja](#2-mental-model-patch-adalah-change-contract-bukan-dto-partial-aja)
3. [PUT vs PATCH vs POST](#3-put-vs-patch-vs-post)
4. [HTTP PATCH menurut RFC 5789](#4-http-patch-menurut-rfc-5789)
5. [`@PATCH` di Jakarta REST](#5-patch-di-jakarta-rest)
6. [Patch Document vs Resource Representation](#6-patch-document-vs-resource-representation)
7. [`Accept-Patch` Header](#7-accept-patch-header)
8. [Media Types untuk PATCH](#8-media-types-untuk-patch)
9. [JSON Merge Patch: `application/merge-patch+json`](#9-json-merge-patch-applicationmerge-patchjson)
10. [JSON Merge Patch Semantics](#10-json-merge-patch-semantics)
11. [Null vs Missing dalam JSON Merge Patch](#11-null-vs-missing-dalam-json-merge-patch)
12. [Array Semantics dalam JSON Merge Patch](#12-array-semantics-dalam-json-merge-patch)
13. [JSON Patch: `application/json-patch+json`](#13-json-patch-applicationjson-patchjson)
14. [JSON Patch Operations](#14-json-patch-operations)
15. [`add`, `remove`, `replace`, `move`, `copy`, `test`](#15-add-remove-replace-move-copy-test)
16. [JSON Pointer Path](#16-json-pointer-path)
17. [Atomicity: All Operations Succeed or None](#17-atomicity-all-operations-succeed-or-none)
18. [Merge Patch vs JSON Patch: Decision Matrix](#18-merge-patch-vs-json-patch-decision-matrix)
19. [Custom Patch DTO: Kapan Boleh?](#19-custom-patch-dto-kapan-boleh)
20. [Presence-Aware DTO](#20-presence-aware-dto)
21. [OptionalField Pattern](#21-optionalfield-pattern)
22. [Why `Optional<T>` Alone Is Usually Not Enough](#22-why-optionalt-alone-is-usually-not-enough)
23. [PATCH Resource Method Design](#23-patch-resource-method-design)
24. [JAX-RS Method Examples](#24-jax-rs-method-examples)
25. [Applying Patch to Current Representation](#25-applying-patch-to-current-representation)
26. [Patch Pipeline Production Model](#26-patch-pipeline-production-model)
27. [Validation Before Patch vs After Patch](#27-validation-before-patch-vs-after-patch)
28. [Field-Level Authorization](#28-field-level-authorization)
29. [Patchable Field Allowlist](#29-patchable-field-allowlist)
30. [Domain State Semantics](#30-domain-state-semantics)
31. [Business Operation vs Structural Patch](#31-business-operation-vs-structural-patch)
32. [Optimistic Concurrency with ETag and `If-Match`](#32-optimistic-concurrency-with-etag-and-if-match)
33. [When to Require Preconditions](#33-when-to-require-preconditions)
34. [PATCH Idempotency](#34-patch-idempotency)
35. [Idempotency-Key for PATCH](#35-idempotency-key-for-patch)
36. [Status Codes for PATCH](#36-status-codes-for-patch)
37. [Response Body Strategy](#37-response-body-strategy)
38. [Problem Details Error Taxonomy](#38-problem-details-error-taxonomy)
39. [Patch and Audit Trail](#39-patch-and-audit-trail)
40. [Patch and Event Design](#40-patch-and-event-design)
41. [Patch and Persistence/JPA](#41-patch-and-persistencejpa)
42. [Patch and JSON Provider](#42-patch-and-json-provider)
43. [Patch and JSON-P](#43-patch-and-json-p)
44. [Patch and JSON-B/Jackson](#44-patch-and-json-bjackson)
45. [Patch and Nested Objects](#45-patch-and-nested-objects)
46. [Patch and Collections](#46-patch-and-collections)
47. [Patch and Nullability](#47-patch-and-nullability)
48. [Patch and Default Values](#48-patch-and-default-values)
49. [Patch and Security](#49-patch-and-security)
50. [Patch and Multi-Tenancy](#50-patch-and-multi-tenancy)
51. [Patch and Observability](#51-patch-and-observability)
52. [Testing PATCH](#52-testing-patch)
53. [OpenAPI Documentation](#53-openapi-documentation)
54. [Runtime Differences and Library Choices](#54-runtime-differences-and-library-choices)
55. [Common Failure Modes](#55-common-failure-modes)
56. [Best Practices](#56-best-practices)
57. [Anti-Patterns](#57-anti-patterns)
58. [Production Checklist](#58-production-checklist)
59. [Latihan](#59-latihan)
60. [Referensi Resmi](#60-referensi-resmi)
61. [Penutup](#61-penutup)

---

# 1. Tujuan Part Ini

Partial update terlihat sederhana:

```http
PATCH /customers/C001
Content-Type: application/json

{
  "displayName": "Fajar"
}
```

Tetapi di production, PATCH sering menjadi sumber bug serius:

- field `null` berarti hapus, abaikan, atau set null?
- field missing berarti no change atau default?
- apakah user boleh mengubah field tersebut?
- apakah status workflow boleh dipatch langsung?
- apakah patch harus idempotent?
- apakah PATCH harus memakai `If-Match`?
- apakah patch terhadap array mengganti seluruh array atau item tertentu?
- apakah validasi dilakukan sebelum atau sesudah patch?
- apakah patch document disimpan di audit log?
- apakah event yang keluar berupa full state atau diff?
- apakah partial update menyebabkan lost update?
- apakah client boleh patch nested object?
- apakah domain invariant tetap terjaga?

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan PUT/PATCH/POST secara tepat;
- memilih JSON Merge Patch atau JSON Patch;
- mendesain custom patch DTO bila perlu;
- menangani null vs missing dengan benar;
- menerapkan field-level authorization;
- memakai optimistic locking dengan ETag/`If-Match`;
- memetakan error PATCH ke Problem Details;
- membuat audit trail yang aman;
- menulis test PATCH yang benar;
- menghindari entity direct patching.

## 1.2 Prinsip utama

```text
PATCH is not “partial DTO”.
PATCH is a contract for applying a change document to a resource under domain rules.
```

---

# 2. Mental Model: PATCH adalah Change Contract, Bukan DTO Partial Aja

PATCH bukan sekadar request body yang field-nya optional.

PATCH harus menjawab:

```text
Apa yang boleh berubah?
Bagaimana client menyatakan perubahan?
Bagaimana server menerapkan perubahan?
Kapan perubahan ditolak?
Apakah perubahan atomic?
Bagaimana concurrency dijaga?
Bagaimana audit/event direpresentasikan?
```

## 2.1 Bad PATCH

```java
@PATCH
public CustomerEntity patch(CustomerEntity incoming) {
    CustomerEntity existing = repository.find(incoming.getId());
    copyNonNullProperties(incoming, existing);
    return repository.save(existing);
}
```

Masalah:

- entity exposure;
- non-null copy membuat null tidak bisa dipakai;
- field internal bisa berubah;
- authorization hilang;
- validation tidak jelas;
- lost update;
- audit buruk;
- domain invariant bisa rusak.

## 2.2 Better PATCH

```text
Load current resource
  ↓
check tenant/resource authorization
  ↓
verify precondition/version
  ↓
parse patch document
  ↓
validate patch syntax and allowed paths/fields
  ↓
apply patch to representation/command model
  ↓
validate resulting command/state
  ↓
execute domain/application operation
  ↓
persist atomically
  ↓
return updated representation or 204 + ETag
  ↓
audit/event with semantic change
```

## 2.3 Top-tier rule

```text
Patch document modifies representation intent.
Domain service decides whether the requested change is valid business operation.
```

---

# 3. PUT vs PATCH vs POST

## 3.1 PUT

PUT generally means replace resource state at target URI with supplied representation.

```http
PUT /customers/C001
Content-Type: application/json

{
  "displayName": "Fajar",
  "email": "fajar@example.com",
  "status": "active"
}
```

Characteristics:

- full replacement semantics;
- idempotent by HTTP semantics;
- missing fields may mean removed/default depending representation contract;
- client sends complete desired state.

## 3.2 PATCH

PATCH applies partial modifications described by patch document.

```http
PATCH /customers/C001
Content-Type: application/merge-patch+json

{
  "displayName": "Fajar"
}
```

Characteristics:

- partial update;
- semantics depend on patch media type;
- not necessarily idempotent;
- patch document is not necessarily full representation;
- often should use `If-Match`.

## 3.3 POST

POST often creates subordinate resource or triggers action/process.

```http
POST /orders/O001/cancellations
```

Use POST when update is actually business action:

- approve;
- submit;
- cancel;
- renew;
- assign;
- transition workflow;
- start export.

## 3.4 Decision

```text
Full replacement? → PUT
Partial structural modification? → PATCH
Domain action/command? → POST
```

## 3.5 Rule

Do not use PATCH for domain commands just because body is small.

---

# 4. HTTP PATCH menurut RFC 5789

RFC 5789 defines PATCH method for partial modifications.

## 4.1 Key idea

PATCH request body contains patch document describing changes to apply to target resource.

## 4.2 PATCH vs PUT

PUT replaces entire resource representation.

PATCH applies partial changes.

## 4.3 Patch format

PATCH itself does not define patch document syntax.

Patch syntax is defined by media type:

```text
application/merge-patch+json
application/json-patch+json
custom media type
```

## 4.4 Atomicity

RFC 5789 states server must apply entire set of changes atomically and must not apply partial changes if whole patch cannot be applied.

## 4.5 Discoverability

Server can advertise supported patch formats using `Accept-Patch`.

## 4.6 Rule

PATCH semantics depend on patch document media type.

---

# 5. `@PATCH` di Jakarta REST

Jakarta REST includes `@PATCH` annotation.

## 5.1 Example

```java
@PATCH
@Path("/customers/{customerId}")
@Consumes("application/merge-patch+json")
@Produces(MediaType.APPLICATION_JSON)
public Response patchCustomer(
    @PathParam("customerId") CustomerId customerId,
    JsonObject patch
) {
    ...
}
```

## 5.2 `@PATCH` meaning

Annotation marks method as responding to HTTP PATCH requests.

## 5.3 Use with `@Consumes`

PATCH must explicitly declare supported patch media type.

```java
@Consumes("application/merge-patch+json")
```

or:

```java
@Consumes("application/json-patch+json")
```

## 5.4 Avoid generic `application/json`

Generic JSON PATCH body has unclear semantics unless you define custom contract.

## 5.5 Rule

Always pair PATCH with explicit patch media type.

---

# 6. Patch Document vs Resource Representation

Patch body is often not resource representation.

## 6.1 Merge Patch mimics representation

```json
{
  "displayName": "New Name"
}
```

Looks like partial resource.

## 6.2 JSON Patch is operation list

```json
[
  { "op": "replace", "path": "/displayName", "value": "New Name" }
]
```

Not representation.

## 6.3 Custom patch DTO

```json
{
  "displayName": {
    "set": "New Name"
  }
}
```

Application-specific patch document.

## 6.4 Consequence

Do not bind PATCH blindly to normal request DTO unless semantics are clear.

## 6.5 Rule

Patch document is a change instruction, not necessarily target object.

---

# 7. `Accept-Patch` Header

Server can advertise patch document media types.

## 7.1 Example

```http
Accept-Patch: application/merge-patch+json, application/json-patch+json
```

## 7.2 Where to include

Common places:

- `OPTIONS` response;
- `405/415` responses if helpful;
- resource metadata endpoint;
- documentation.

## 7.3 JAX-RS response filter

```java
response.getHeaders().putSingle(
    "Accept-Patch",
    "application/merge-patch+json, application/json-patch+json"
);
```

Apply only to resources supporting PATCH.

## 7.4 Rule

Use `Accept-Patch` to make patch formats discoverable.

---

# 8. Media Types untuk PATCH

## 8.1 JSON Merge Patch

```text
application/merge-patch+json
```

Defined by RFC 7396.

## 8.2 JSON Patch

```text
application/json-patch+json
```

Defined by RFC 6902.

## 8.3 Custom

```text
application/vnd.example.customer-patch+json
```

Useful if domain-specific semantics.

## 8.4 Generic JSON

```text
application/json
```

Avoid unless documented as custom partial DTO format.

## 8.5 Rule

Patch media type is part of patch semantics.

---

# 9. JSON Merge Patch: `application/merge-patch+json`

JSON Merge Patch describes changes using syntax that closely resembles target JSON document.

## 9.1 Example target

```json
{
  "displayName": "Old",
  "email": "old@example.com",
  "phone": "123"
}
```

Patch:

```json
{
  "displayName": "New",
  "phone": null
}
```

Result:

```json
{
  "displayName": "New",
  "email": "old@example.com"
}
```

`phone` removed because value is null.

## 9.2 Good for

- simple object updates;
- forms;
- field set/remove;
- small resources.

## 9.3 Not good for

- precise array item updates;
- moving/copying values;
- operations that need test precondition;
- expressing multiple operations with paths.

## 9.4 Rule

JSON Merge Patch is simple and natural for object-shaped resources.

---

# 10. JSON Merge Patch Semantics

Simplified algorithm:

```text
If patch is object:
  for each member:
    if value is null:
      remove member from target
    else:
      recursively merge value into target member
Else:
  replace entire target with patch
```

## 10.1 Object patch

```json
{
  "name": "Fajar"
}
```

sets/replaces `name`.

## 10.2 Null member

```json
{
  "middleName": null
}
```

removes `middleName`.

## 10.3 Non-object patch

```json
"hello"
```

replaces entire target with string.

For REST resources, usually reject non-object merge patch unless resource supports it.

## 10.4 Rule

Merge Patch null means removal, not “ignore”.

---

# 11. Null vs Missing dalam JSON Merge Patch

This is the most important concept.

## 11.1 Missing

Patch:

```json
{
  "displayName": "New"
}
```

Field `email` missing means:

```text
no change to email
```

## 11.2 Null

Patch:

```json
{
  "email": null
}
```

means:

```text
remove email
```

or set field absent in target JSON.

## 11.3 Domain mapping

If domain field is nullable:

```text
remove may map to null
```

If domain field is required:

```text
remove invalid → validation error
```

## 11.4 Common bug

Using DTO with Java null cannot distinguish:

```text
missing field
explicit null field
```

## 11.5 Rule

Merge Patch requires presence-aware processing.

---

# 12. Array Semantics dalam JSON Merge Patch

Merge Patch does not patch array elements individually.

## 12.1 Example target

```json
{
  "tags": ["a", "b", "c"]
}
```

Patch:

```json
{
  "tags": ["a", "c"]
}
```

Result replaces entire array:

```json
{
  "tags": ["a", "c"]
}
```

## 12.2 Cannot express remove only element index 1

Merge Patch has no array operation.

## 12.3 For array item ops

Use JSON Patch:

```json
[
  { "op": "remove", "path": "/tags/1" }
]
```

## 12.4 Domain caution

Array replacement can cause lost updates.

## 12.5 Rule

Use Merge Patch for object fields; use JSON Patch or domain commands for precise collection changes.

---

# 13. JSON Patch: `application/json-patch+json`

JSON Patch defines a JSON document structure expressing sequence of operations.

## 13.1 Example

```json
[
  { "op": "replace", "path": "/displayName", "value": "New Name" },
  { "op": "remove", "path": "/phone" }
]
```

## 13.2 Good for

- precise operations;
- array item manipulation;
- conditional `test`;
- audit-like operation list;
- client-generated diffs.

## 13.3 More complex

Clients and server must understand JSON Pointer paths and operation semantics.

## 13.4 Rule

JSON Patch is powerful but needs stricter validation.

---

# 14. JSON Patch Operations

RFC 6902 defines operations:

```text
add
remove
replace
move
copy
test
```

Each operation is an object with `op` and `path`, plus additional members depending operation.

## 14.1 Operation list

Patch document is JSON array.

```json
[
  { "op": "test", "path": "/version", "value": 3 },
  { "op": "replace", "path": "/displayName", "value": "New" }
]
```

## 14.2 Order matters

Operations applied sequentially.

## 14.3 Path matters

Paths use JSON Pointer syntax.

## 14.4 Rule

JSON Patch is an ordered operation program over JSON document.

---

# 15. `add`, `remove`, `replace`, `move`, `copy`, `test`

## 15.1 `add`

Adds value at path.

```json
{ "op": "add", "path": "/tags/-", "value": "new" }
```

## 15.2 `remove`

Removes value at path.

```json
{ "op": "remove", "path": "/phone" }
```

## 15.3 `replace`

Replaces existing value.

```json
{ "op": "replace", "path": "/displayName", "value": "New" }
```

## 15.4 `move`

Moves value from one path to another.

```json
{ "op": "move", "from": "/oldPath", "path": "/newPath" }
```

## 15.5 `copy`

Copies value.

```json
{ "op": "copy", "from": "/billingAddress", "path": "/shippingAddress" }
```

## 15.6 `test`

Asserts current value equals expected.

```json
{ "op": "test", "path": "/status", "value": "draft" }
```

If test fails, patch fails.

## 15.7 Rule

`test` is useful but does not replace ETag for resource-level concurrency.

---

# 16. JSON Pointer Path

JSON Patch uses JSON Pointer paths.

## 16.1 Examples

```text
/displayName
/address/postalCode
/tags/0
/tags/-
```

## 16.2 Escaping

`~` and `/` have special escaping:

```text
~0 for ~
~1 for /
```

## 16.3 Array index

```text
/tags/0
```

refers first element.

`-` can append for `add`.

## 16.4 Public path names

Paths should refer to public JSON representation fields, not Java fields/DB columns.

## 16.5 Rule

JSON Patch paths are API contract.

---

# 17. Atomicity: All Operations Succeed or None

PATCH must be atomic per RFC 5789.

## 17.1 JSON Patch example

If operation 3 fails, operations 1 and 2 must not persist.

## 17.2 Transaction

Apply patch and persist within transaction.

## 17.3 In-memory apply first

Generate candidate state.

Validate.

Then persist.

## 17.4 Avoid partial flush

Do not call repository save after each operation.

## 17.5 Rule

Patch application is all-or-nothing.

---

# 18. Merge Patch vs JSON Patch: Decision Matrix

## 18.1 Use JSON Merge Patch when

- update is mostly object fields;
- client submits form-like partial object;
- null-as-remove is acceptable;
- array replacement is acceptable;
- simplicity matters.

## 18.2 Use JSON Patch when

- need precise array operations;
- need `test`;
- need ordered operations;
- need path-level changes;
- client can generate operation list.

## 18.3 Use custom command when

- operation has business meaning;
- workflow transition;
- complex invariants;
- field authorization depends on action;
- audit should record semantic action.

Example:

```http
POST /cases/{id}/assignments
POST /orders/{id}/cancellations
POST /applications/{id}/submissions
```

## 18.4 Rule

Choose patch format based on domain semantics, not library availability.

---

# 19. Custom Patch DTO: Kapan Boleh?

Custom partial DTO can be okay.

## 19.1 Example

```json
{
  "displayName": "New",
  "email": "new@example.com"
}
```

with media type:

```text
application/vnd.example.customer-partial-update+json
```

or documented `application/json`.

## 19.2 Problem

Java null cannot distinguish missing vs explicit null unless custom handling.

## 19.3 Works if

- null is not allowed;
- you treat null as invalid;
- fields are optional only by presence;
- you use presence wrapper.

## 19.4 Better media type

If custom semantics differ from Merge Patch/JSON Patch, do not pretend it is standard merge patch.

## 19.5 Rule

Custom patch DTO must define missing/null semantics explicitly.

---

# 20. Presence-Aware DTO

To patch correctly, you need know if field was present.

## 20.1 Three states

```text
ABSENT
PRESENT_NULL
PRESENT_VALUE
```

## 20.2 Java null only gives two states

```text
null
non-null
```

Cannot tell absent vs explicit null.

## 20.3 Use JSON-P

`JsonObject` can tell:

```java
json.containsKey("email")
json.isNull("email")
```

## 20.4 Use custom deserializer

Jackson/JSON-B custom handling can track presence.

## 20.5 Rule

PATCH DTOs need presence semantics.

---

# 21. OptionalField Pattern

## 21.1 Model

```java
public sealed interface OptionalField<T> permits OptionalField.Absent, OptionalField.Present {
    record Absent<T>() implements OptionalField<T> {}
    record Present<T>(T value) implements OptionalField<T> {}
}
```

## 21.2 DTO

```java
public record PatchCustomerRequest(
    OptionalField<String> displayName,
    OptionalField<String> email,
    OptionalField<String> phone
) {}
```

## 21.3 Semantics

```text
Absent → no change
Present(null) → clear/remove if allowed
Present(value) → set value
```

## 21.4 Requires custom binding

JSON provider must be configured to populate `Absent` when missing.

## 21.5 Rule

OptionalField is useful for custom patch DTOs but requires serialization support and tests.

---

# 22. Why `Optional<T>` Alone Is Usually Not Enough

## 22.1 `Optional.empty()`

Could mean:

```text
missing
```

or:

```text
present null
```

depending deserializer.

## 22.2 Optional as field

Many Java style guides discourage `Optional` as DTO field.

## 22.3 Need three states

PATCH needs absent/present-null/present-value.

`Optional<T>` only naturally models two states.

## 22.4 Rule

Use explicit presence wrapper or JSON tree for PATCH.

---

# 23. PATCH Resource Method Design

## 23.1 Merge Patch method

```java
@PATCH
@Path("/customers/{customerId}")
@Consumes("application/merge-patch+json")
@Produces(MediaType.APPLICATION_JSON)
public Response mergePatchCustomer(
    @PathParam("customerId") CustomerId customerId,
    JsonObject patch,
    @Context Request request
) {
    ...
}
```

## 23.2 JSON Patch method

```java
@PATCH
@Path("/customers/{customerId}")
@Consumes("application/json-patch+json")
@Produces(MediaType.APPLICATION_JSON)
public Response jsonPatchCustomer(
    @PathParam("customerId") CustomerId customerId,
    JsonArray patchOps,
    @Context Request request
) {
    ...
}
```

## 23.3 Same path, different consumes

JAX-RS can dispatch based on `Content-Type`.

## 23.4 Avoid ambiguous generic consumes

Do not define:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

for standard patch unless custom.

## 23.5 Rule

Use media type to separate patch formats.

---

# 24. JAX-RS Method Examples

## 24.1 Merge Patch with JSON-P

```java
@PATCH
@Path("/{customerId}")
@Consumes("application/merge-patch+json")
@Produces(MediaType.APPLICATION_JSON)
public Response patchCustomer(
    @PathParam("customerId") CustomerId customerId,
    JsonObject mergePatch,
    @HeaderParam("If-Match") String ifMatch
) {
    CustomerResponse updated = service.applyMergePatch(customerId, mergePatch, ifMatch);
    return Response.ok(updated)
        .tag(updated.etag())
        .build();
}
```

## 24.2 JSON Patch

```java
@PATCH
@Path("/{customerId}")
@Consumes("application/json-patch+json")
@Produces(MediaType.APPLICATION_JSON)
public Response patchCustomer(
    @PathParam("customerId") CustomerId customerId,
    JsonArray patchDocument,
    @HeaderParam("If-Match") String ifMatch
) {
    CustomerResponse updated = service.applyJsonPatch(customerId, patchDocument, ifMatch);
    return Response.ok(updated)
        .tag(updated.etag())
        .build();
}
```

## 24.3 No content response

```java
return Response.noContent()
    .tag(newEtag)
    .build();
```

## 24.4 Rule

PATCH method should be thin: parse boundary, call application service, return updated state/ETag.

---

# 25. Applying Patch to Current Representation

Common strategy:

```text
domain/entity → response representation JSON
apply patch to representation JSON
patched JSON → update command
validate command
execute domain update
```

## 25.1 Why representation?

Patch paths are public JSON fields.

## 25.2 Avoid patching entity directly

Entity fields may differ from API fields.

## 25.3 Mapper needed

```text
CustomerAggregate → CustomerPatchView
patched CustomerPatchView → UpdateCustomerCommand
```

## 25.4 Candidate state

Patch creates candidate desired state.

Then domain service validates and applies.

## 25.5 Rule

Patch public representation/command model, not persistence entity.

---

# 26. Patch Pipeline Production Model

Recommended pipeline:

```text
1. Authenticate
2. Load current resource by tenant-safe query
3. Check resource access
4. Verify If-Match/version
5. Parse patch document
6. Validate patch document syntax
7. Check allowed paths/fields
8. Check field-level authorization
9. Apply patch to patchable representation
10. Validate resulting representation/command
11. Execute domain update inside transaction
12. Persist and update version
13. Emit audit/event
14. Return updated representation or 204 with ETag
```

## 26.1 Why order matters

If you apply patch before authorization, you may expose information via error details.

If you validate before load, you may not know field permissions.

If you persist before full validation, atomicity breaks.

## 26.2 Rule

PATCH is a pipeline, not a setter shortcut.

---

# 27. Validation Before Patch vs After Patch

## 27.1 Validate patch document before apply

Check:

- valid JSON;
- valid patch format;
- allowed operations;
- allowed paths;
- max operations;
- max depth/size.

## 27.2 Validate candidate after apply

Check:

- required fields still present;
- field formats;
- cross-field constraints;
- domain command constraints.

## 27.3 Example

Patch:

```json
{
  "email": null
}
```

Patch document is syntactically valid.

But resulting customer may violate:

```text
email is required
```

## 27.4 Rule

You need both patch-document validation and resulting-state validation.

---

# 28. Field-Level Authorization

Partial update must check whether actor may change each field/path.

## 28.1 Example

Officer may update:

```text
displayName
phone
address
```

Only supervisor may update:

```text
status
assignedOfficer
```

System only may update:

```text
riskScore
auditFields
```

## 28.2 Merge Patch

Inspect keys:

```java
if (patch.containsKey("status") && !actor.canChangeStatus()) reject;
```

## 28.3 JSON Patch

Inspect paths:

```text
/status
/assignedOfficer
/address/postalCode
```

## 28.4 Nested

Authorize path prefix carefully.

## 28.5 Rule

If actor cannot modify a field, reject patch before applying.

---

# 29. Patchable Field Allowlist

Define allowed fields per resource/operation.

## 29.1 Example

```java
Set<String> patchableMergeFields = Set.of(
    "displayName",
    "phone",
    "address"
);
```

## 29.2 JSON Patch paths

```java
Set<String> allowedPathPrefixes = Set.of(
    "/displayName",
    "/phone",
    "/address"
);
```

## 29.3 Reject unknown/internal

```text
/id
/tenantId
/status
/createdAt
/updatedAt
/version
/roles
```

## 29.4 Avoid silent ignore

Reject not ignore.

## 29.5 Rule

Patchable fields are an explicit allowlist.

---

# 30. Domain State Semantics

Some fields are not just data; changing them triggers domain meaning.

## 30.1 Example

Changing `status` from:

```text
draft → submitted
```

is not a field update.

It is business operation:

```http
POST /applications/{id}/submissions
```

## 30.2 Example assignment

```json
{ "assignedOfficer": "U123" }
```

May need:

- workload check;
- permission;
- audit;
- notification;
- state transition.

Better as:

```http
POST /cases/{id}/assignments
```

## 30.3 Rule

If changing a field has business workflow meaning, model it as command resource, not generic PATCH.

---

# 31. Business Operation vs Structural Patch

## 31.1 Structural patch

Good:

- phone;
- displayName;
- address line;
- notification preferences.

## 31.2 Business operation

Use POST:

- submit;
- approve;
- reject;
- cancel;
- assign;
- reopen;
- archive.

## 31.3 Why

Business operation needs:

- action name;
- actor intent;
- preconditions;
- reason/comment;
- audit;
- event type.

PATCH hides action as field mutation.

## 31.4 Rule

PATCH is for structural modifications; POST command is for semantic operations.

---

# 32. Optimistic Concurrency with ETag and `If-Match`

Partial updates are vulnerable to lost updates.

## 32.1 Scenario

Client A reads version 1.

Client B updates email to version 2.

Client A PATCHes phone based on version 1.

Could overwrite or conflict depending patch.

## 32.2 Use ETag

GET response:

```http
ETag: "customer-C001-v1"
```

PATCH request:

```http
If-Match: "customer-C001-v1"
```

## 32.3 Server behavior

If current ETag differs:

```text
412 Precondition Failed
```

## 32.4 JAX-RS Request

```java
Response.ResponseBuilder precondition = request.evaluatePreconditions(currentEtag);
if (precondition != null) {
    return precondition.build();
}
```

## 32.5 Rule

Require `If-Match` for PATCH on important mutable resources.

---

# 33. When to Require Preconditions

## 33.1 Require for

- user-editable resources;
- financial data;
- workflow resources;
- concurrent collaboration;
- admin updates;
- patching nested structures;
- array/list updates.

## 33.2 Maybe optional for

- idempotent single-field preference update;
- last-write-wins metrics;
- append-only low-risk data.

## 33.3 Missing precondition

Use:

```text
428 Precondition Required
```

if your API requires `If-Match`.

## 33.4 Failed precondition

Use:

```text
412 Precondition Failed
```

## 33.5 Rule

Concurrency policy should be explicit, not accidental last-write-wins.

---

# 34. PATCH Idempotency

PATCH is not necessarily idempotent.

## 34.1 Idempotent examples

Merge Patch:

```json
{ "displayName": "New" }
```

Applying repeatedly yields same state.

JSON Patch replace:

```json
[{ "op": "replace", "path": "/displayName", "value": "New" }]
```

Usually idempotent if path exists.

## 34.2 Non-idempotent examples

JSON Patch add to array:

```json
[{ "op": "add", "path": "/tags/-", "value": "x" }]
```

Repeated application appends multiple times.

## 34.3 Move/copy can be non-idempotent

Depends on current state.

## 34.4 Rule

Do not claim PATCH is idempotent unless your patch contract guarantees it.

---

# 35. Idempotency-Key for PATCH

Use `Idempotency-Key` for retry-safe unsafe operations.

## 35.1 When useful

- network retry;
- mobile clients;
- payment-like operations;
- non-idempotent JSON Patch operations;
- integration callbacks.

## 35.2 Key binding

Bind key to:

- actor;
- resource;
- method;
- URI;
- body hash;
- operation type.

## 35.3 Conflict

Same key with different body:

```text
409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY
```

## 35.4 Rule

Idempotency key is request replay control, not replacement for ETag.

---

# 36. Status Codes for PATCH

## 36.1 Success

```text
200 OK
```

with updated representation.

```text
204 No Content
```

with updated ETag.

## 36.2 Created?

PATCH can create resource if patch document semantics and permissions allow, but many APIs forbid this.

## 36.3 Client errors

```text
400 malformed patch
401 unauthenticated
403 forbidden field/resource
404 resource not found
409 domain conflict
412 precondition failed
415 unsupported patch media type
422 semantic validation failed if policy uses 422
428 precondition required
```

## 36.4 Server errors

```text
500 unexpected
503 dependency unavailable
```

## 36.5 Rule

PATCH error code should identify failing stage.

---

# 37. Response Body Strategy

## 37.1 Return updated representation

```http
200 OK
ETag: "v2"

{ ... updated resource ... }
```

Pros:

- client immediately syncs;
- shows server-derived fields;
- good for UI.

## 37.2 Return no content

```http
204 No Content
ETag: "v2"
```

Pros:

- smaller response.

Cons:

- client may need follow-up GET.

## 37.3 Recommendation

For user-facing APIs, return updated representation.

For high-throughput/simple APIs, 204 + ETag can be okay.

## 37.4 Rule

Always return new ETag/version if resource changed.

---

# 38. Problem Details Error Taxonomy

Recommended codes:

```text
UNSUPPORTED_PATCH_MEDIA_TYPE
MALFORMED_PATCH_DOCUMENT
INVALID_PATCH_OPERATION
INVALID_PATCH_PATH
PATCH_PATH_NOT_ALLOWED
PATCH_FIELD_FORBIDDEN
PATCH_TEST_FAILED
PATCH_RESULT_INVALID
PATCH_ARRAY_OPERATION_NOT_ALLOWED
PRECONDITION_REQUIRED
PRECONDITION_FAILED
RESOURCE_VERSION_CONFLICT
DOMAIN_STATE_CONFLICT
```

## 38.1 Example

```json
{
  "type": "https://api.example.com/problems/patch-path-not-allowed",
  "title": "Patch path is not allowed",
  "status": 400,
  "code": "PATCH_PATH_NOT_ALLOWED",
  "detail": "The path '/status' cannot be patched with this endpoint.",
  "correlationId": "..."
}
```

## 38.2 Field/path

Include safe path:

```json
"path": "/status"
```

## 38.3 Do not reveal hidden fields

If path targets internal/forbidden field, be careful with detail.

## 38.4 Rule

PATCH errors should be machine-readable and path-aware.

---

# 39. Patch and Audit Trail

PATCH audit should answer:

- who changed;
- what resource;
- what fields/paths;
- old/new values if allowed;
- when;
- why/correlation;
- source IP/client;
- version before/after.

## 39.1 Raw patch document

Store raw patch? Maybe.

Risk:

- PII;
- secrets;
- malformed data;
- field names change over time.

## 39.2 Semantic audit

Better:

```json
{
  "action": "CUSTOMER_PARTIALLY_UPDATED",
  "changes": [
    { "field": "displayName", "from": "Old", "to": "New" }
  ]
}
```

## 39.3 Redaction

Sensitive fields:

```text
password
token
secret
```

Never store raw values.

## 39.4 Rule

Audit semantic changes, not just raw HTTP body.

---

# 40. Patch and Event Design

## 40.1 Event options

Full-state event:

```text
CustomerUpdated
```

with new representation.

Diff event:

```text
CustomerPatched
```

with changes.

Domain event:

```text
CustomerEmailChanged
```

## 40.2 Domain event preferred for business meaning

If email changed, event can be semantic.

## 40.3 Avoid leaking patch syntax

Downstream should not depend on JSON Patch paths unless event contract says so.

## 40.4 Outbox

Persist update and event atomically.

## 40.5 Rule

Do not let HTTP patch document become internal event contract accidentally.

---

# 41. Patch and Persistence/JPA

## 41.1 Avoid direct entity binding

Bad:

```java
CustomerEntity patchEntity
```

## 41.2 Load entity

```java
Customer customer = repository.getForUpdate(id, tenant);
```

## 41.3 Apply domain methods

```java
customer.changeDisplayName(command.displayName());
customer.changePhone(command.phone());
```

## 41.4 Version

Use optimistic locking column.

```java
@Version
long version;
```

## 41.5 Transaction

Patch apply + validation + persist + outbox should be one transaction.

## 41.6 Rule

Patch should call domain/application methods, not mutate entity fields blindly.

---

# 42. Patch and JSON Provider

## 42.1 JSON-B/Jackson DTO binding

Normal DTO binding loses missing/null unless configured.

## 42.2 JSON-P tree

`JsonObject`/`JsonArray` preserves exact patch document shape.

## 42.3 Provider errors

Malformed JSON or wrong media type maps before patch logic.

## 42.4 Recommendation

Use JSON-P/tree model for standard Merge Patch/JSON Patch.

## 42.5 Rule

PATCH document is often better processed as JSON tree than DTO.

---

# 43. Patch and JSON-P

Jakarta JSON Processing includes APIs around JSON objects/arrays and patch-related operations depending version/runtime.

## 43.1 Merge Patch conceptual flow

```java
JsonMergePatch mergePatch = Json.createMergePatch(patchJsonValue);
JsonValue patched = mergePatch.apply(currentJson);
```

## 43.2 JSON Patch conceptual flow

```java
JsonPatch jsonPatch = Json.createPatch(patchArray);
JsonValue patched = jsonPatch.apply(currentJson);
```

## 43.3 Then convert patched representation

```text
patched JSON → PatchCandidate DTO/command
```

## 43.4 Validate after apply

Run Jakarta Validation/domain validation.

## 43.5 Rule

JSON-P is natural fit for standard JSON patch document processing.

---

# 44. Patch and JSON-B/Jackson

## 44.1 Jackson JsonNode

Many stacks use Jackson tree:

```java
JsonNode patch
JsonNode current
```

with JSON Patch/Merge Patch libraries.

## 44.2 JSON-B

Object binding is less ideal for presence-aware patch unless custom support.

## 44.3 Custom deserializer

Can populate OptionalField wrappers.

## 44.4 Test

Provider behavior for null/missing must be tested.

## 44.5 Rule

If using object binding for PATCH, prove presence semantics with tests.

---

# 45. Patch and Nested Objects

## 45.1 Merge Patch nested

Target:

```json
{
  "address": {
    "line1": "Old",
    "postalCode": "123"
  }
}
```

Patch:

```json
{
  "address": {
    "postalCode": "456"
  }
}
```

Result:

```json
{
  "address": {
    "line1": "Old",
    "postalCode": "456"
  }
}
```

## 45.2 Removing nested field

```json
{
  "address": {
    "line1": null
  }
}
```

Removes line1.

## 45.3 Replacing nested object

If field value is non-object or target not object, replacement can happen.

## 45.4 Domain validation

Address may require line1; patch result may be invalid.

## 45.5 Rule

Nested patch requires careful validation and field authorization by path.

---

# 46. Patch and Collections

## 46.1 Merge Patch collection

Entire array replaced.

## 46.2 JSON Patch collection

Can add/remove by index.

## 46.3 Index fragility

Array index can change if concurrent edits.

Use ETag/If-Match.

## 46.4 Domain collection operations

For domain collections, consider command endpoints:

```http
POST /customers/{id}/addresses
DELETE /customers/{id}/addresses/{addressId}
```

## 46.5 Rule

Do not use generic PATCH for complex collection workflows unless you accept complexity.

---

# 47. Patch and Nullability

## 47.1 Required field

If patch removes required field:

```text
PATCH_RESULT_INVALID
```

## 47.2 Optional nullable field

Patch null may clear field.

## 47.3 Non-nullable database column

Must reject before DB error.

## 47.4 JSON Merge Patch null

Means remove, not necessarily Java null.

Domain mapping decides.

## 47.5 Rule

Nullability must be specified per field in patch contract.

---

# 48. Patch and Default Values

## 48.1 Missing field

No change.

Do not apply default again.

## 48.2 Null removal

Could cause default fallback depending domain.

Define.

## 48.3 Example

Notification preference missing:

```text
no change
```

Notification preference null:

```text
reset to default?
clear?
invalid?
```

Choose and document.

## 48.4 Rule

Defaults in PATCH must be explicit, not accidental deserializer behavior.

---

# 49. Patch and Security

## 49.1 Attack surface

Patch can try:

```json
{ "role": "admin" }
```

or:

```json
[
  { "op": "replace", "path": "/tenantId", "value": "other" }
]
```

## 49.2 Defenses

- path/field allowlist;
- field-level authorization;
- tenant/resource auth;
- max patch size;
- max operations;
- max depth;
- no internal fields;
- audit.

## 49.3 Do not reveal internal fields

If path `/passwordHash` rejected, response should not confirm hidden field exists.

## 49.4 Rule

PATCH must be allowlist-driven.

---

# 50. Patch and Multi-Tenancy

## 50.1 Load by tenant

```sql
SELECT ... WHERE id = ? AND tenant_id = actor.tenant_id
```

## 50.2 Cursor not relevant, but tenant path/header is

If path includes tenant:

```http
PATCH /tenants/T1/customers/C001
```

verify actor can access T1.

## 50.3 Patch cannot change tenant

Reject:

```json
{ "tenantId": "T2" }
```

## 50.4 Rule

Tenant is immutable security boundary for PATCH.

---

# 51. Patch and Observability

## 51.1 Metrics

```text
patch_requests_total{resource,format,status}
patch_rejected_total{code,path_group}
patch_duration_seconds{resource,format}
patch_operations_count_bucket{resource}
```

## 51.2 Logs

Log:

- actor;
- resource type/id if allowed;
- patch format;
- changed field names;
- status/error code;
- correlation ID.

## 51.3 Do not log raw patch body

Can contain PII/secrets.

## 51.4 Trace

Add event:

```text
patch.applied
patch.rejected
```

with safe attributes.

## 51.5 Rule

Observe patch behavior without leaking patch values.

---

# 52. Testing PATCH

## 52.1 Media type tests

- merge patch content type accepted;
- json patch content type accepted;
- `application/json` rejected if unsupported;
- no content type rejected.

## 52.2 Merge Patch tests

- missing field no change;
- null removes/clears;
- required null rejected;
- nested update;
- array replacement.

## 52.3 JSON Patch tests

- add;
- remove;
- replace;
- move;
- copy;
- test success/fail;
- invalid path;
- disallowed path;
- operation atomicity.

## 52.4 Concurrency tests

- missing If-Match → 428 if required;
- stale If-Match → 412;
- current If-Match → success.

## 52.5 Authorization tests

- field allowed;
- field forbidden;
- tenant mismatch;
- resource hidden policy.

## 52.6 Audit/event tests

- changed fields captured;
- sensitive values redacted.

## 52.7 Rule

PATCH needs more negative tests than happy path tests.

---

# 53. OpenAPI Documentation

## 53.1 Document media types

```yaml
requestBody:
  content:
    application/merge-patch+json:
      schema:
        type: object
    application/json-patch+json:
      schema:
        type: array
```

## 53.2 Document supported fields/paths

For merge patch:

```text
Patchable fields: displayName, phone, address
```

For JSON Patch:

```text
Allowed paths: /displayName, /phone, /address/...
```

## 53.3 Document preconditions

```text
If-Match required.
```

## 53.4 Document errors

- invalid patch;
- forbidden field;
- precondition failed;
- validation failed.

## 53.5 Rule

PATCH docs must describe semantics, not only schema.

---

# 54. Runtime Differences and Library Choices

## 54.1 Jakarta REST 4.0

Jakarta REST 4.0 adds JSON Merge Patch support at spec/release level.

Actual convenient APIs depend on runtime and JSON-P integration.

## 54.2 JSON-P

Good standard option for patch documents.

## 54.3 Jackson libraries

Many applications use Jackson-based JSON Patch/Merge Patch libraries.

## 54.4 RESTEasy/Jersey/CXF/Liberty/Quarkus

Provider support, JSON-P versions, and integration can differ.

## 54.5 Rule

Test patch behavior on target runtime and chosen JSON library.

---

# 55. Common Failure Modes

## 55.1 Treating PATCH DTO null as no change

Explicit null semantics lost.

## 55.2 Generic `application/json` PATCH undocumented

Client/server disagree.

## 55.3 No field allowlist

Mass assignment vulnerability.

## 55.4 Patching JPA entity directly

Security and invariant leak.

## 55.5 No If-Match

Lost update.

## 55.6 JSON Patch array index race

Wrong element modified.

## 55.7 Merge Patch array expected item update

Actually replaces whole array.

## 55.8 Partial operation persisted

Atomicity violation.

## 55.9 Domain command hidden as status patch

Workflow bypass.

## 55.10 Raw patch logged

PII/security leak.

## 55.11 Cursor? Not applicable, but stale representation token ignored

Concurrency bug.

## 55.12 Unsupported patch media returns 500

Should be 415.

---

# 56. Best Practices

## 56.1 Use explicit patch media type

`application/merge-patch+json` or `application/json-patch+json`.

## 56.2 Prefer Merge Patch for simple object partial updates

Good for forms.

## 56.3 Prefer JSON Patch for precise operations

Especially arrays/test operations.

## 56.4 Use command endpoints for domain transitions

Do not patch workflow status casually.

## 56.5 Require If-Match for important resources

Avoid lost updates.

## 56.6 Field/path allowlist

Reject unknown or forbidden paths.

## 56.7 Validate before and after apply

Patch document + resulting state.

## 56.8 Keep PATCH atomic

Transaction boundary.

## 56.9 Return updated ETag

Always.

## 56.10 Test null/missing/array semantics

Core compatibility tests.

---

# 57. Anti-Patterns

## 57.1 `copyNonNullProperties`

Destroys null semantics.

## 57.2 Entity as patch request

Mass assignment.

## 57.3 PATCH all fields including status/roles/tenant

Security nightmare.

## 57.4 No media type distinction

Ambiguous semantics.

## 57.5 No concurrency control

Lost updates.

## 57.6 Raw JSON Patch as event contract

Internal coupling to HTTP details.

## 57.7 Ignore failed operation and continue

Violates atomicity.

## 57.8 Patch array by index without version

Race bugs.

## 57.9 Logging body

PII leak.

## 57.10 Business operations as field mutations

Weak audit and bypass risk.

---

# 58. Production Checklist

## 58.1 Contract

- [ ] PATCH media types explicitly documented.
- [ ] Merge Patch null/missing semantics documented.
- [ ] JSON Patch allowed operations documented.
- [ ] Allowed fields/paths documented.
- [ ] Array semantics documented.
- [ ] Response strategy documented.
- [ ] `Accept-Patch` considered.

## 58.2 Security

- [ ] Field/path allowlist.
- [ ] Field-level authorization.
- [ ] Tenant-safe resource loading.
- [ ] Internal fields forbidden.
- [ ] Max patch size/depth/operations.
- [ ] Raw body not logged.
- [ ] Sensitive audit values redacted.

## 58.3 Concurrency

- [ ] ETag/version exists.
- [ ] `If-Match` required where needed.
- [ ] Missing precondition handled.
- [ ] Stale precondition returns 412.
- [ ] Updated ETag returned.
- [ ] Idempotency key considered for non-idempotent patches.

## 58.4 Validation/domain

- [ ] Patch document syntax validated.
- [ ] Patchable paths validated.
- [ ] Resulting state validated.
- [ ] Domain invariants enforced.
- [ ] Workflow transitions not generic patch.
- [ ] Patch apply and persist atomic.

## 58.5 Tests

- [ ] Missing vs null tests.
- [ ] Array tests.
- [ ] Disallowed field tests.
- [ ] Authorization tests.
- [ ] Stale ETag tests.
- [ ] Atomicity tests.
- [ ] Audit/event tests.
- [ ] Runtime media-type dispatch tests.

---

# 59. Latihan

## Latihan 1 — Merge Patch Basic

Endpoint:

```http
PATCH /customers/{id}
Content-Type: application/merge-patch+json
If-Match: "v1"
```

Support fields:

```text
displayName
phone
address
```

Test:

- missing no change;
- null clears phone;
- null displayName rejected;
- disallowed status rejected.

## Latihan 2 — JSON Patch Basic

Endpoint:

```http
PATCH /customers/{id}
Content-Type: application/json-patch+json
```

Support operations:

```text
replace
remove
test
```

Reject:

```text
move
copy
add
```

unless intentionally supported.

## Latihan 3 — Field Authorization

Role USER can patch phone.

Role ADMIN can patch displayName and phone.

Nobody can patch tenantId/status.

Test all combinations.

## Latihan 4 — ETag

GET returns:

```http
ETag: "v1"
```

PATCH with stale ETag returns 412.

PATCH without If-Match returns 428 if policy requires.

## Latihan 5 — Atomicity

JSON Patch:

```json
[
  { "op": "replace", "path": "/phone", "value": "123" },
  { "op": "replace", "path": "/status", "value": "admin" }
]
```

Second op disallowed.

Assert phone not changed.

## Latihan 6 — Audit

Patch displayName and phone.

Audit stores field names and redacted values according policy.

## Latihan 7 — Domain Command Refactor

If current API allows:

```json
{ "status": "approved" }
```

via PATCH, refactor to:

```http
POST /applications/{id}/approvals
```

with reason/comment.

## Latihan 8 — Merge Patch Array

Target has tags.

Patch tags array.

Prove entire array is replaced.

Document.

## Latihan 9 — Problem Details

Map:

- invalid media → 415;
- malformed patch → 400;
- disallowed path → 400/403 according policy;
- stale version → 412;
- domain conflict → 409.

---

# 60. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — Release Notes  
   https://jakarta.ee/specifications/restful-ws/4.0/

3. Jakarta RESTful Web Services 4.0.0 Release Record  
   https://projects.eclipse.org/projects/ee4j.rest/releases/4.0.0

4. Jakarta RESTful Web Services API — `PATCH` annotation  
   https://jakarta.ee/specifications/restful-ws/2.1/apidocs/javax/ws/rs/patch  
   Note: historical `javax.ws.rs.PATCH`; in Jakarta namespace use `jakarta.ws.rs.PATCH`.

5. RFC 5789 — PATCH Method for HTTP  
   https://datatracker.ietf.org/doc/html/rfc5789

6. RFC 7396 — JSON Merge Patch  
   https://datatracker.ietf.org/doc/html/rfc7396

7. RFC 6902 — JavaScript Object Notation (JSON) Patch  
   https://datatracker.ietf.org/doc/html/rfc6902

8. RFC 6901 — JavaScript Object Notation (JSON) Pointer  
   https://datatracker.ietf.org/doc/html/rfc6901

9. RFC 9110 — HTTP Semantics  
   https://datatracker.ietf.org/doc/html/rfc9110

---

# 61. Penutup

PATCH adalah salah satu area REST API yang paling mudah terlihat sederhana tetapi paling banyak jebakannya.

Mental model final:

```text
PATCH request
  ↓
patch document media type defines syntax and semantics
  ↓
server validates patch document
  ↓
server checks allowed fields/paths and authorization
  ↓
server applies patch atomically to current representation/candidate
  ↓
server validates resulting state and domain invariants
  ↓
server persists with concurrency control
  ↓
server returns updated representation/ETag or no-content/ETag
```

Prinsip final:

```text
PUT replaces.
PATCH modifies.
POST commands.
```

Dan:

```text
Missing is not null.
Patch format is not resource format.
Field update is not always business operation.
PATCH without concurrency control can lose updates.
```

Top-tier JAX-RS engineer memastikan:

- PATCH media type eksplisit;
- null/missing semantics benar;
- field/path allowlist;
- field-level authorization;
- domain invariant tetap dijaga;
- ETag/If-Match dipakai untuk mutable resource;
- patch atomic;
- audit semantic;
- raw body tidak bocor;
- test negatif lengkap.

Part berikutnya:

```text
Bagian 022 — Conditional Requests, ETag, Last-Modified, Optimistic Concurrency
```

Kita akan membahas HTTP conditional requests secara mendalam: validators, strong/weak ETags, Last-Modified, If-Match, If-None-Match, If-Unmodified-Since, 304, 412, 428, caching, and lost update prevention.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-020.md](./learn-jaxrs-advanced-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-022.md](./learn-jaxrs-advanced-part-022.md)
