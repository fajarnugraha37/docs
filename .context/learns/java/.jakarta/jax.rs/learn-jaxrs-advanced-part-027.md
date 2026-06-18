# learn-jaxrs-advanced-part-027.md

# Bagian 027 — Multipart and File Upload: `multipart/form-data`, `EntityPart`, Streaming Upload, Size Limits, Malware Scanning, Content-Type Validation, Object Storage, Transactional Metadata, and Secure File Handling

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **multipart upload dan file upload security** di JAX-RS/Jakarta REST secara production-grade. Fokus bagian ini bukan hanya “terima file dari form”, tetapi memahami multipart contract, Jakarta REST `EntityPart`, streaming upload, metadata, validation, MIME sniffing, filename security, storage design, object storage, virus/malware scanning, quarantine workflow, transaction boundary, idempotency, resumable upload strategy, audit, observability, dan testing.
>
> Namespace utama: `jakarta.ws.rs.Consumes`, `jakarta.ws.rs.FormParam`, `jakarta.ws.rs.core.EntityPart`, `jakarta.ws.rs.core.MediaType.MULTIPART_FORM_DATA`, `jakarta.ws.rs.core.Response`, `java.io.InputStream`, `java.nio.file.Files`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Upload adalah Ingress of Untrusted Bytes](#2-mental-model-upload-adalah-ingress-of-untrusted-bytes)
3. [`multipart/form-data` Menurut RFC 7578](#3-multipartform-data-menurut-rfc-7578)
4. [Multipart Body Anatomy](#4-multipart-body-anatomy)
5. [Form Field vs File Part](#5-form-field-vs-file-part)
6. [Jakarta REST Multipart Support dan `EntityPart`](#6-jakarta-rest-multipart-support-dan-entitypart)
7. [Basic Upload Endpoint dengan `EntityPart`](#7-basic-upload-endpoint-dengan-entitypart)
8. [Multiple Parts: `List<EntityPart>`](#8-multiple-parts-listentitypart)
9. [Binding dengan `@FormParam`](#9-binding-dengan-formparam)
10. [`EntityPart` API: Name, FileName, Headers, MediaType, Content](#10-entitypart-api-name-filename-headers-mediatype-content)
11. [Portable vs Runtime-Specific Multipart APIs](#11-portable-vs-runtime-specific-multipart-apis)
12. [Upload Contract Design](#12-upload-contract-design)
13. [Single File Upload](#13-single-file-upload)
14. [Multiple File Upload](#14-multiple-file-upload)
15. [Upload Metadata](#15-upload-metadata)
16. [JSON Metadata + File Upload](#16-json-metadata--file-upload)
17. [Upload Response Design](#17-upload-response-design)
18. [201 Created vs 202 Accepted](#18-201-created-vs-202-accepted)
19. [Streaming Upload Pipeline](#19-streaming-upload-pipeline)
20. [Do Not Load Whole File into Memory](#20-do-not-load-whole-file-into-memory)
21. [Size Limits: Request, Part, File, Tenant, User](#21-size-limits-request-part-file-tenant-user)
22. [Early Rejection and 413 Payload Too Large](#22-early-rejection-and-413-payload-too-large)
23. [Filename Security](#23-filename-security)
24. [Content-Type Validation](#24-content-type-validation)
25. [Magic Number / File Signature Validation](#25-magic-number--file-signature-validation)
26. [Extension Allowlist](#26-extension-allowlist)
27. [MIME Sniffing Risk](#27-mime-sniffing-risk)
28. [Malware / Virus Scanning](#28-malware--virus-scanning)
29. [Quarantine Workflow](#29-quarantine-workflow)
30. [Content Disarm and Reconstruction / CDR](#30-content-disarm-and-reconstruction--cdr)
31. [Archive Uploads: ZIP, TAR, Nested Files](#31-archive-uploads-zip-tar-nested-files)
32. [Zip Slip and Path Traversal](#32-zip-slip-and-path-traversal)
33. [Zip Bomb / Decompression Bomb](#33-zip-bomb--decompression-bomb)
34. [Image Uploads](#34-image-uploads)
35. [PDF Uploads](#35-pdf-uploads)
36. [Office Document Uploads](#36-office-document-uploads)
37. [Executable/Script Uploads](#37-executablescript-uploads)
38. [Storage Design: Filesystem vs Object Storage vs Database](#38-storage-design-filesystem-vs-object-storage-vs-database)
39. [Object Storage Pattern](#39-object-storage-pattern)
40. [Pre-Signed Upload URL Pattern](#40-pre-signed-upload-url-pattern)
41. [Direct-to-App Upload vs Direct-to-Object-Storage Upload](#41-direct-to-app-upload-vs-direct-to-object-storage-upload)
42. [Transactional Metadata Boundary](#42-transactional-metadata-boundary)
43. [Outbox/Event Workflow for Scanning](#43-outboxevent-workflow-for-scanning)
44. [Idempotency for Upload](#44-idempotency-for-upload)
45. [Deduplication and Checksums](#45-deduplication-and-checksums)
46. [ETag/Version for Uploaded Document](#46-etagversion-for-uploaded-document)
47. [Authorization and Tenant Isolation](#47-authorization-and-tenant-isolation)
48. [Field-Level and Document-Type Authorization](#48-field-level-and-document-type-authorization)
49. [Rate Limiting, Quotas, and Abuse Control](#49-rate-limiting-quotas-and-abuse-control)
50. [CSRF/CORS Considerations](#50-csrfcors-considerations)
51. [Error Handling and Problem Details](#51-error-handling-and-problem-details)
52. [Audit Trail](#52-audit-trail)
53. [Observability](#53-observability)
54. [Metrics](#54-metrics)
55. [Tracing](#55-tracing)
56. [Logging](#56-logging)
57. [Testing Multipart Upload](#57-testing-multipart-upload)
58. [Testing File Security](#58-testing-file-security)
59. [Testing Large Uploads and Client Abort](#59-testing-large-uploads-and-client-abort)
60. [OpenAPI Documentation](#60-openapi-documentation)
61. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#61-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
62. [Common Failure Modes](#62-common-failure-modes)
63. [Best Practices](#63-best-practices)
64. [Anti-Patterns](#64-anti-patterns)
65. [Production Checklist](#65-production-checklist)
66. [Latihan](#66-latihan)
67. [Referensi Resmi](#67-referensi-resmi)
68. [Penutup](#68-penutup)

---

# 1. Tujuan Part Ini

File upload adalah salah satu fitur yang tampak sederhana tetapi sangat berisiko.

Endpoint sederhana:

```java
@POST
@Path("/documents")
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(@FormParam("file") EntityPart file) {
    ...
}
```

Secara bisnis, ini terlihat seperti:

```text
User upload dokumen.
```

Secara security, sebenarnya ini adalah:

```text
User mengirim byte tidak terpercaya ke sistem kita,
lalu sistem kita menyimpan, memproses, memindai, mengindeks,
menampilkan, dan mungkin mengirimkannya kembali ke user lain.
```

## 1.1 Kenapa upload berbahaya?

Upload bisa menyebabkan:

- remote code execution jika file dieksekusi oleh server;
- XSS jika HTML/SVG di-serve inline;
- malware distribution;
- storage exhaustion;
- decompression bomb;
- path traversal;
- overwrite file;
- tenant data leak;
- SSRF/forgery melalui parser dokumen;
- parser exploit;
- PII leakage;
- audit gap;
- quota abuse;
- malicious filename/header injection.

## 1.2 Target akhir

Setelah bagian ini, kamu bisa:

- memahami `multipart/form-data`;
- memakai `EntityPart` secara portable;
- mendesain upload contract;
- streaming file tanpa memory blow-up;
- menerapkan size limit dan quota;
- memvalidasi extension, MIME, magic number;
- menyimpan ke object storage dengan aman;
- membangun quarantine + malware scanning workflow;
- menjaga transactional metadata;
- membuat error contract;
- menguji upload besar dan malicious file;
- menghindari common file upload vulnerabilities.

## 1.3 Prinsip utama

```text
File upload is not “just another request body”.
It is an ingestion pipeline for untrusted binary content.
```

---

# 2. Mental Model: Upload adalah Ingress of Untrusted Bytes

Upload pipeline production:

```text
HTTP multipart request
  ↓
request size limit
  ↓
multipart parser
  ↓
part identification
  ↓
metadata validation
  ↓
stream to temporary/quarantine storage
  ↓
checksum and size calculation
  ↓
type/extension/magic validation
  ↓
malware scan / CDR if needed
  ↓
metadata transaction
  ↓
object storage promotion
  ↓
domain event/audit
  ↓
download allowed only after safe state
```

## 2.1 Bad mental model

```text
Client says Content-Type image/png and filename profile.png,
therefore file is a safe PNG.
```

Wrong.

Both filename and content type are client-controlled hints.

## 2.2 Better mental model

```text
Client-provided metadata is untrusted.
Server verifies policy.
Stored object identity is server-generated.
Original filename is display metadata only.
Uploaded bytes remain untrusted until validated/scanned.
```

## 2.3 Top-tier rule

```text
Never let user-controlled file content become executable, renderable, or trusted without policy.
```

---

# 3. `multipart/form-data` Menurut RFC 7578

`multipart/form-data` is a media type used to carry form fields and files as multiple body parts.

## 3.1 Content-Type

```http
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
```

Boundary separates parts.

## 3.2 Each part

Each part has its own headers and body.

Common headers:

```http
Content-Disposition: form-data; name="file"; filename="report.pdf"
Content-Type: application/pdf
```

## 3.3 Used for uploads

Common browser form upload uses:

```html
<form method="post" enctype="multipart/form-data">
```

## 3.4 Rule

Multipart body is a container of named parts; each part is still untrusted input.

---

# 4. Multipart Body Anatomy

Example raw shape:

```http
POST /documents HTTP/1.1
Content-Type: multipart/form-data; boundary=abc

--abc
Content-Disposition: form-data; name="documentType"

identity-card
--abc
Content-Disposition: form-data; name="file"; filename="id-card.pdf"
Content-Type: application/pdf

...bytes...
--abc--
```

## 4.1 Boundary

Boundary is not part of file content.

## 4.2 Field part

Text metadata:

```text
documentType = identity-card
```

## 4.3 File part

Binary content plus file metadata.

## 4.4 Multiple files

Same field name can appear multiple times depending form contract.

## 4.5 Rule

Multipart is not JSON; validation must inspect part names, counts, headers, and content.

---

# 5. Form Field vs File Part

## 5.1 Form field

Usually small textual value.

Examples:

```text
documentType
description
caseId
```

## 5.2 File part

Potentially large stream.

Examples:

```text
file
attachment
avatar
```

## 5.3 Do not treat all parts equally

- fields can be read as strings;
- file content should stream;
- file part headers need validation;
- file part size limit matters.

## 5.4 Rule

Upload contract must specify required parts, optional parts, max counts, and semantics.

---

# 6. Jakarta REST Multipart Support dan `EntityPart`

Jakarta REST introduced standard portable multipart support via `EntityPart`.

`EntityPart` represents one part of a multipart entity.

## 6.1 Important

Before standard multipart support, many JAX-RS apps used vendor-specific APIs:

- Jersey multipart;
- RESTEasy multipart;
- Apache CXF multipart;
- Servlet `Part`.

Now portable Jakarta REST APIs can be used where runtime supports them.

## 6.2 Media type

Multipart upload consumes:

```java
@Consumes(MediaType.MULTIPART_FORM_DATA)
```

## 6.3 EntityPart

`EntityPart` gives access to:

- part name;
- optional filename;
- media type;
- headers;
- content as Java type;
- content stream.

## 6.4 Rule

Prefer standard `EntityPart` for portability when using Jakarta REST 3.1/4.0-capable runtime.

---

# 7. Basic Upload Endpoint dengan `EntityPart`

```java
@Path("/documents")
public class DocumentResource {

    @POST
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upload(@FormParam("file") EntityPart filePart) {
        String submittedName = filePart.getFileName()
            .orElse("uploaded.bin");

        MediaType mediaType = filePart.getMediaType();

        try (InputStream input = filePart.getContent(InputStream.class)) {
            UploadedDocument doc = documentService.store(
                submittedName,
                mediaType,
                input
            );

            URI location = URI.create("/documents/" + doc.id());
            return Response.created(location)
                .entity(doc)
                .build();
        }
    }
}
```

## 7.1 Missing in this simple example

Production still needs:

- size limits;
- filename sanitization;
- content validation;
- scanning;
- storage policy;
- auth;
- audit;
- error mapping;
- object storage lifecycle;
- transaction boundary.

## 7.2 Rule

Basic upload sample is only parser usage, not secure upload design.

---

# 8. Multiple Parts: `List<EntityPart>`

You can consume all parts as a list.

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(List<EntityPart> parts) {
    ...
}
```

## 8.1 Why useful

- strict unknown part policy;
- duplicate detection;
- dynamic part names;
- multiple files;
- manual validation.

## 8.2 Parse by name

```java
Map<String, List<EntityPart>> byName = parts.stream()
    .collect(Collectors.groupingBy(EntityPart::getName));
```

## 8.3 Validate

```text
file exactly once
metadata exactly once
no unknown parts
max files <= N
```

## 8.4 Rule

For serious upload contracts, inspecting all parts is often safer than binding only expected parts.

---

# 9. Binding dengan `@FormParam`

`@FormParam` can bind form parts by name.

## 9.1 Example

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(
    @FormParam("documentType") String documentType,
    @FormParam("file") EntityPart file
) {
    ...
}
```

## 9.2 Good for simple contract

Works when:

- few fixed fields;
- no unknown part policy needed;
- runtime behavior tested.

## 9.3 Caveat

Unknown parts may be ignored depending how you bind.

If unknown parts should be rejected, inspect `List<EntityPart>`.

## 9.4 Rule

Use `@FormParam` for simple forms; use `List<EntityPart>` for strict multipart validation.

---

# 10. `EntityPart` API: Name, FileName, Headers, MediaType, Content

Conceptual methods:

```java
String getName()
Optional<String> getFileName()
MediaType getMediaType()
MultivaluedMap<String, String> getHeaders()
<T> T getContent(Class<T> type)
```

## 10.1 Name

Form field name.

```text
file
metadata
documentType
```

## 10.2 FileName

Submitted filename from `Content-Disposition`.

Untrusted.

## 10.3 MediaType

Part `Content-Type`.

Untrusted hint.

## 10.4 Headers

Part-level headers.

Validate only known/supported headers.

## 10.5 Content

Read content as:

```java
InputStream.class
String.class
```

or another supported type.

For files, prefer `InputStream`.

## 10.6 Rule

Treat everything from `EntityPart` as untrusted until validated.

---

# 11. Portable vs Runtime-Specific Multipart APIs

## 11.1 Standard `EntityPart`

Use when runtime supports Jakarta REST 3.1/4.0 multipart.

## 11.2 Runtime-specific APIs

May still be needed for:

- older JAX-RS versions;
- advanced streaming configuration;
- existing codebase;
- performance-specific behavior.

Examples:

- Jersey multipart module;
- RESTEasy multipart annotations;
- Servlet `Part`.

## 11.3 Migration

When migrating, test:

- memory behavior;
- temp file threshold;
- max part size;
- content stream lifecycle;
- file name handling;
- multiple parts.

## 11.4 Rule

Multipart behavior is implementation-sensitive; portability still needs runtime tests.

---

# 12. Upload Contract Design

Define upload contract explicitly.

## 12.1 Questions

```text
Which endpoint?
Which parts are required?
Which media types allowed?
Max file size?
Max request size?
Max file count?
Is metadata JSON or form field?
Is scanning synchronous or asynchronous?
When is file downloadable?
What is response status?
How to retry?
How to delete/reupload?
```

## 12.2 Example contract

```http
POST /cases/{caseId}/documents
Content-Type: multipart/form-data
```

Parts:

```text
metadata: application/json, required
file: binary, required, max 20 MiB
```

Allowed file types:

```text
PDF, PNG, JPEG
```

Response:

```text
202 Accepted if scan async
Location: /documents/{id}
```

## 12.3 Rule

Upload endpoint without explicit contract becomes vulnerability and operations problem.

---

# 13. Single File Upload

## 13.1 Endpoint

```http
POST /profile/avatar
Content-Type: multipart/form-data
```

Parts:

```text
file: required, image/png or image/jpeg, max 2 MiB
```

## 13.2 Semantics

Does upload replace existing avatar?

Options:

- create new document;
- replace current avatar;
- create version;
- pending until scan.

## 13.3 Response

```http
202 Accepted
Location: /profile/avatar/uploads/U123
```

if scan async.

Or:

```http
200 OK
```

if immediate replacement after validation.

## 13.4 Rule

Even single upload needs state semantics.

---

# 14. Multiple File Upload

## 14.1 Endpoint

```http
POST /cases/{caseId}/documents/batch
```

## 14.2 Design questions

- all-or-nothing or partial success?
- max count?
- per-file max?
- total request max?
- metadata per file?
- scanning per file?
- response item status?

## 14.3 Prefer explicit batch response

```json
{
  "batchId": "B001",
  "items": [
    { "clientFileId": "a", "documentId": "D1", "status": "accepted" },
    { "clientFileId": "b", "code": "FILE_TOO_LARGE", "status": "rejected" }
  ]
}
```

## 14.4 Rule

Multiple upload is batch processing; define partial failure semantics.

---

# 15. Upload Metadata

Metadata examples:

- document type;
- description;
- case ID;
- file category;
- retention classification;
- confidentiality;
- client file ID;
- checksum;
- declared content type.

## 15.1 Form fields

```text
documentType=identity-card
description=...
```

Good for simple metadata.

## 15.2 JSON metadata part

```http
Content-Disposition: form-data; name="metadata"
Content-Type: application/json
```

Good for structured metadata.

## 15.3 Validate metadata

Use Jakarta Validation/domain rules.

## 15.4 Rule

Metadata is untrusted and must be validated like JSON request body.

---

# 16. JSON Metadata + File Upload

## 16.1 Contract

Parts:

```text
metadata: application/json
file: application/pdf
```

## 16.2 Example

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(List<EntityPart> parts) {
    EntityPart metadataPart = requireSingle(parts, "metadata");
    EntityPart filePart = requireSingle(parts, "file");

    UploadMetadata metadata = metadataPart.getContent(UploadMetadata.class);

    try (InputStream file = filePart.getContent(InputStream.class)) {
        return uploadService.upload(metadata, filePart, file);
    }
}
```

## 16.3 Benefit

Clear separation:

```text
metadata JSON
file bytes
```

## 16.4 Rule

Do not encode complex metadata in filename or custom headers.

---

# 17. Upload Response Design

## 17.1 Synchronous safe upload

```http
201 Created
Location: /documents/D001

{
  "documentId": "D001",
  "status": "available"
}
```

## 17.2 Async scan upload

```http
202 Accepted
Location: /documents/D001

{
  "documentId": "D001",
  "status": "pending_scan"
}
```

## 17.3 Rejected

```http
400 Bad Request
```

or:

```http
415 Unsupported Media Type
```

or:

```http
413 Payload Too Large
```

with Problem Details.

## 17.4 Rule

Response must tell client whether file is usable, pending, or rejected.

---

# 18. 201 Created vs 202 Accepted

## 18.1 Use 201

When file is fully accepted and available.

```text
validation complete
storage complete
scan complete or not required
metadata committed
```

## 18.2 Use 202

When upload accepted for processing but not yet safe/available.

```text
stored in quarantine
scan pending
OCR pending
conversion pending
```

## 18.3 Avoid 200 for created file

Use 201/202 to express lifecycle.

## 18.4 Rule

If scanning is async, prefer 202 and status resource.

---

# 19. Streaming Upload Pipeline

## 19.1 Pipeline

```text
read InputStream
  ↓
count bytes
  ↓
compute checksum
  ↓
write to temp/quarantine/object storage
  ↓
validate file signature
  ↓
commit metadata
```

## 19.2 Example copy

```java
long bytes = 0;
MessageDigest sha256 = MessageDigest.getInstance("SHA-256");

try (InputStream in = filePart.getContent(InputStream.class);
     OutputStream out = storage.openWrite(tempKey)) {

    byte[] buffer = new byte[64 * 1024];

    int read;
    while ((read = in.read(buffer)) != -1) {
        bytes += read;
        if (bytes > maxBytes) {
            throw new FileTooLargeException(maxBytes);
        }

        sha256.update(buffer, 0, read);
        out.write(buffer, 0, read);
    }
}
```

## 19.3 Do not rely only on Content-Length

Client may omit or lie.

Count actual bytes.

## 19.4 Rule

Upload streaming should count, hash, and enforce limits while copying.

---

# 20. Do Not Load Whole File into Memory

## 20.1 Bad

```java
byte[] file = filePart.getContent(byte[].class);
```

for large/untrusted file.

## 20.2 Bad

```java
ByteArrayOutputStream buffer = new ByteArrayOutputStream();
input.transferTo(buffer);
```

without strict small limit.

## 20.3 Good

Stream to bounded storage.

## 20.4 Small file exception

For tiny avatars/config files, byte array may be acceptable only with strict max size enforced before allocation.

## 20.5 Rule

For file upload, default to streaming.

---

# 21. Size Limits: Request, Part, File, Tenant, User

## 21.1 Layers

- gateway request size limit;
- app server multipart limit;
- JAX-RS/runtime parser limit;
- application file size limit;
- per-part limit;
- total batch limit;
- tenant storage quota;
- user daily quota.

## 21.2 Application-level count

Even if gateway limits request size, count actual file bytes.

## 21.3 Error codes

- `413 Payload Too Large`;
- `422`/`400` for business max file policy;
- `429` for rate/quota depending case.

## 21.4 Rule

Set limits at multiple layers.

---

# 22. Early Rejection and 413 Payload Too Large

## 22.1 Content-Length

If request `Content-Length` exceeds limit, reject before reading body if possible.

## 22.2 Streaming count

If no length or multipart overhead, reject during copy when byte count exceeds limit.

## 22.3 Problem Details

```json
{
  "code": "FILE_TOO_LARGE",
  "status": 413,
  "detail": "Maximum file size is 20 MiB."
}
```

## 22.4 Cleanup

Delete partial temp object/file.

## 22.5 Rule

Reject large uploads early and clean partial data.

---

# 23. Filename Security

Filename is attacker-controlled.

## 23.1 Risks

```text
../../etc/passwd
C:\Windows\system32\cmd.exe
evil.jpg.exe
report.pdf%00.exe
"\r\nHeader: injected"
confusable unicode
very-long-name...
```

## 23.2 Do not use as storage key

Bad:

```java
Path target = uploadDir.resolve(fileName);
```

## 23.3 Generate server key

```text
documents/{tenantId}/{uuid}
```

Store original filename as display metadata after sanitization.

## 23.4 Sanitize for display/download

- remove path separators;
- trim control chars;
- limit length;
- normalize unicode;
- use safe fallback.

## 23.5 Rule

Original filename is metadata only, never trusted path.

---

# 24. Content-Type Validation

Part header:

```http
Content-Type: application/pdf
```

is client-controlled.

## 24.1 Use as hint

Do not trust alone.

## 24.2 Compare with detected type

Policy:

```text
declared type must be allowed
detected type must be allowed
extension must match allowed type
```

## 24.3 Mismatch

Reject or quarantine.

## 24.4 Rule

Content-Type header is not proof of file type.

---

# 25. Magic Number / File Signature Validation

Magic number is file signature at beginning bytes.

## 25.1 Examples

PDF:

```text
%PDF-
```

PNG:

```text
89 50 4E 47 0D 0A 1A 0A
```

JPEG:

```text
FF D8 FF
```

## 25.2 Use libraries

Do not write incomplete detection for complex formats.

## 25.3 Polyglot files

Some files can satisfy multiple signatures.

## 25.4 Rule

Magic number validation is useful but not sufficient security.

---

# 26. Extension Allowlist

## 26.1 Allowlist

```text
.pdf
.png
.jpg
.jpeg
```

## 26.2 Do not use denylist

Bad:

```text
reject .exe only
```

Attackers use `.jsp`, `.svg`, `.html`, `.php`, `.sh`, `.cmd`, etc.

## 26.3 Normalize

- lower-case;
- trim spaces;
- handle multiple extensions.

## 26.4 Rule

Use extension allowlist plus content validation.

---

# 27. MIME Sniffing Risk

Browsers may interpret content differently if served inline.

## 27.1 Risk

Uploaded file declared as image but contains HTML/JS.

If served from same origin, can cause XSS.

## 27.2 Defenses

- store outside webroot;
- serve downloads with `Content-Disposition: attachment`;
- set correct `Content-Type`;
- set `X-Content-Type-Options: nosniff`;
- serve user content from separate domain if needed;
- sanitize/CDR.

## 27.3 Rule

Upload security includes safe download/rendering.

---

# 28. Malware / Virus Scanning

OWASP recommends scanning uploaded files where appropriate.

## 28.1 When needed

- documents from external users;
- files later downloaded by other users;
- government/enterprise systems;
- email-like attachments;
- office/PDF/archive files.

## 28.2 Scan options

- AV scanner service;
- ICAP server;
- cloud malware scanning;
- sandbox;
- CDR pipeline;
- asynchronous scanning worker.

## 28.3 Blocking vs async

Small low-risk upload can scan synchronously.

Large/high-latency scanning usually async.

## 28.4 Rule

Unscanned uploaded files should not be available as trusted downloads.

---

# 29. Quarantine Workflow

## 29.1 States

```text
UPLOADING
QUARANTINED
SCAN_PENDING
SAFE
REJECTED_MALWARE
REJECTED_POLICY
DELETED
```

## 29.2 Flow

```text
upload → quarantine storage → scan → promote to safe storage
```

## 29.3 Access

Only allow download when:

```text
status == SAFE
```

unless admin/security workflow.

## 29.4 Rule

Quarantine is safer than immediately publishing uploaded content.

---

# 30. Content Disarm and Reconstruction / CDR

CDR removes risky active content.

## 30.1 Use cases

- PDF;
- Office documents;
- images with metadata/scripts;
- documents from external parties.

## 30.2 Trade-offs

- can change document;
- may break formatting;
- requires specialized tooling;
- audit original vs sanitized.

## 30.3 Rule

For high-security document workflows, malware scanning may not be enough; consider CDR.

---

# 31. Archive Uploads: ZIP, TAR, Nested Files

Archives are dangerous.

## 31.1 Risks

- zip slip;
- zip bomb;
- nested archives;
- too many files;
- huge uncompressed size;
- malicious internal filenames;
- executable content hidden inside.

## 31.2 Policy

Often reject archives unless necessary.

If allowed:

- inspect all entries;
- enforce max entries;
- enforce max uncompressed size;
- enforce max nesting;
- scan extracted content safely;
- never extract to unsafe path.

## 31.3 Rule

Archive upload needs separate threat model.

---

# 32. Zip Slip and Path Traversal

Zip entry:

```text
../../../../etc/passwd
```

If extracted naively, can overwrite files outside target directory.

## 32.1 Defense

Normalize and check path:

```java
Path target = base.resolve(entryName).normalize();
if (!target.startsWith(base)) {
    throw new UnsafeArchiveEntryException();
}
```

## 32.2 Also reject absolute paths

```text
/etc/passwd
C:\...
```

## 32.3 Rule

Never trust archive entry names.

---

# 33. Zip Bomb / Decompression Bomb

Small compressed file can expand massively.

## 33.1 Defense

Track:

- uncompressed bytes;
- compression ratio;
- number of entries;
- nesting depth;
- time limit.

## 33.2 Reject suspicious

```text
ratio too high
total uncompressed size too high
```

## 33.3 Rule

Do not decompress archives without strict limits.

---

# 34. Image Uploads

## 34.1 Validation

- allowed image types;
- decode with image library;
- dimension limits;
- pixel count limit;
- strip metadata if needed;
- re-encode to safe format.

## 34.2 Risks

- image parser vulnerabilities;
- huge dimensions causing memory DoS;
- metadata PII/geolocation;
- SVG scripts if SVG allowed.

## 34.3 SVG

Treat SVG as active content unless sanitized. Often reject for avatars.

## 34.4 Rule

For avatars, decode and re-encode image server-side.

---

# 35. PDF Uploads

## 35.1 Risks

- embedded JavaScript;
- malicious PDF exploits;
- embedded files;
- phishing links;
- huge/complex PDF;
- parser vulnerabilities.

## 35.2 Controls

- scan;
- CDR if high security;
- render/download as attachment;
- avoid inline same-origin rendering for untrusted PDFs;
- size/page count limits.

## 35.3 Rule

PDF is not “safe because it is document”.

---

# 36. Office Document Uploads

## 36.1 Risks

- macros;
- embedded objects;
- external links;
- malware;
- sensitive metadata.

## 36.2 Controls

- scan;
- macro policy;
- CDR;
- convert to PDF for viewing;
- quarantine until safe.

## 36.3 Rule

Office documents need strict scanning and policy.

---

# 37. Executable/Script Uploads

Typically reject:

```text
.exe .dll .bat .cmd .sh .php .jsp .jar .war .html .svg
```

depending system.

## 37.1 Dangerous if stored under webroot

Could become executable or renderable.

## 37.2 Some systems need code upload

If product requires it, isolate heavily.

## 37.3 Rule

Default-deny executable/script content.

---

# 38. Storage Design: Filesystem vs Object Storage vs Database

## 38.1 Filesystem

Pros:

- simple;
- fast local IO.

Cons:

- scaling;
- backup;
- path traversal risk;
- webroot mistakes;
- cluster consistency.

## 38.2 Object storage

Pros:

- scalable;
- durable;
- metadata;
- lifecycle;
- access policies;
- pre-signed URLs.

Cons:

- eventual consistency details;
- egress/cost;
- network dependency;
- direct upload complexity.

## 38.3 Database BLOB

Pros:

- transactional with metadata;
- backup together.

Cons:

- DB bloat;
- performance;
- operational load.

## 38.4 Rule

Object storage is usually best for large uploaded files; DB stores metadata.

---

# 39. Object Storage Pattern

## 39.1 Keys

Server-generated:

```text
tenant/{tenantId}/documents/{documentId}/original
```

or non-guessable key:

```text
objects/{uuid}
```

## 39.2 Buckets

Separate:

```text
quarantine
safe
rejected
```

or prefix/state metadata.

## 39.3 Metadata DB

Store:

- document ID;
- tenant ID;
- owner;
- original filename;
- detected content type;
- size;
- checksum;
- storage key;
- status;
- scan result.

## 39.4 Rule

Object key is internal; document ID is public resource identity.

---

# 40. Pre-Signed Upload URL Pattern

## 40.1 Flow

1. Client requests upload session.
2. Server authorizes and creates upload intent.
3. Server returns pre-signed object storage URL.
4. Client uploads directly to object storage.
5. Server receives callback or client completes upload.
6. Server validates metadata/scans/promotes.

## 40.2 Pros

- app server avoids bandwidth;
- object storage handles large upload;
- resumable/multipart object upload possible.

## 40.3 Cons

- more complex;
- client talks to storage;
- callback/finalization needed;
- security of URL;
- CORS on storage bucket.

## 40.4 Rule

Pre-signed upload is excellent for large files but requires upload session state machine.

---

# 41. Direct-to-App Upload vs Direct-to-Object-Storage Upload

## 41.1 Direct-to-app

Good when:

- small files;
- strict scanning inline;
- simple clients;
- audit/control in app.

## 41.2 Direct-to-storage

Good when:

- large files;
- high volume;
- cloud object storage;
- app bandwidth expensive;
- resumable upload needed.

## 41.3 Hybrid

App handles metadata and security; storage handles bytes.

## 41.4 Rule

Choose upload path based on file size, security, volume, and infrastructure.

---

# 42. Transactional Metadata Boundary

You cannot put object storage write and database commit in one local transaction easily.

## 42.1 Problem

Object write succeeds, DB commit fails.

Or DB commit succeeds, object write fails.

## 42.2 Pattern

Use state machine:

```text
UPLOAD_INITIATED
OBJECT_STORED
METADATA_COMMITTED
SCAN_PENDING
SAFE
FAILED
```

## 42.3 Cleanup orphan objects

Scheduled cleanup for uncommitted/temp/quarantine objects.

## 42.4 Rule

Use eventual consistency/state machine, not pretend object storage is part of DB transaction.

---

# 43. Outbox/Event Workflow for Scanning

## 43.1 After upload metadata committed

Persist outbox event:

```text
DocumentUploadedToQuarantine
```

## 43.2 Scanner consumes

Scanner reads object, scans, updates status:

```text
SAFE
REJECTED_MALWARE
REJECTED_POLICY
```

## 43.3 Notification

Emit:

```text
DocumentScanCompleted
```

## 43.4 Rule

Scanning pipeline should be durable and retryable.

---

# 44. Idempotency for Upload

Upload clients retry after timeout.

## 44.1 Idempotency-Key

```http
POST /documents
Idempotency-Key: abc
```

Bind to:

- actor;
- tenant;
- endpoint;
- metadata hash;
- file checksum if known.

## 44.2 Client file ID

Batch uploads can include:

```text
clientFileId
```

for deduplication.

## 44.3 Response replay

Same key returns same document/upload status.

## 44.4 Rule

Upload endpoints should define retry behavior.

---

# 45. Deduplication and Checksums

## 45.1 Checksum

Compute SHA-256 while streaming.

```text
sha256
```

## 45.2 Uses

- dedup;
- integrity;
- audit;
- idempotency;
- malware scan cache.

## 45.3 Client checksum

Client can submit checksum metadata.

Server verifies while reading.

## 45.4 Dedup caution

Dedup across tenants can leak existence if not designed carefully.

## 45.5 Rule

Checksum is useful, but dedup must respect security boundaries.

---

# 46. ETag/Version for Uploaded Document

After accepted, document resource should have version/ETag.

## 46.1 Document metadata ETag

Changes when metadata/status changes.

```http
ETag: "doc-D001-v3"
```

## 46.2 File content ETag

Could be checksum/content version.

## 46.3 Download ETag

Should represent file bytes served.

## 46.4 Rule

Separate metadata version from binary content identity when needed.

---

# 47. Authorization and Tenant Isolation

## 47.1 Before accepting bytes

Check actor can upload to target resource.

```text
Can user attach document to case C001?
```

## 47.2 Tenant-safe lookup

```sql
WHERE case_id = ? AND tenant_id = actor.tenant_id
```

## 47.3 Storage key isolation

Include tenant/internal partition or enforce metadata.

## 47.4 Download re-check

Upload authorization does not imply every user can download.

## 47.5 Rule

Upload and download both require independent authorization.

---

# 48. Field-Level and Document-Type Authorization

Different document types may have different policies.

## 48.1 Example

Applicant can upload:

```text
identity document
supporting document
```

Officer can upload:

```text
internal memo
inspection report
```

Only system can upload:

```text
generated certificate
```

## 48.2 Validate document type

Do not trust metadata.

## 48.3 Rule

Document type is policy input, not just label.

---

# 49. Rate Limiting, Quotas, and Abuse Control

## 49.1 Limits

- upload requests per minute;
- bytes per day;
- concurrent uploads;
- pending scan count;
- storage quota per tenant;
- max files per case;
- max batch size.

## 49.2 Abuse

Attackers can fill storage or scanning queue.

## 49.3 Response

```http
429 Too Many Requests
```

or:

```http
403 QUOTA_EXCEEDED
```

depending policy.

## 49.4 Rule

Upload must have quota and abuse control.

---

# 50. CSRF/CORS Considerations

## 50.1 Browser upload with cookie auth

State-changing POST with cookies is CSRF-relevant.

Use CSRF token / SameSite / Origin checks.

## 50.2 CORS

If frontend and API are cross-origin:

- allow exact origin;
- allow credentials if cookies;
- allow headers required;
- max request size at gateway.

## 50.3 Preflight

Multipart upload can be complex. Browser behavior depends on headers/content type handling.

## 50.4 Rule

Browser upload security combines auth, CSRF, CORS, and size limits.

---

# 51. Error Handling and Problem Details

## 51.1 Error codes

```text
MISSING_PART
UNKNOWN_PART
DUPLICATE_PART
FILE_TOO_LARGE
UNSUPPORTED_FILE_TYPE
FILENAME_INVALID
CONTENT_TYPE_MISMATCH
MALWARE_DETECTED
SCAN_UNAVAILABLE
QUOTA_EXCEEDED
UPLOAD_ABORTED
STORAGE_WRITE_FAILED
CHECKSUM_MISMATCH
```

## 51.2 Example

```json
{
  "type": "https://api.example.com/problems/file-too-large",
  "title": "File too large",
  "status": 413,
  "code": "FILE_TOO_LARGE",
  "detail": "Maximum upload size is 20 MiB.",
  "maxBytes": 20971520,
  "correlationId": "..."
}
```

## 51.3 Do not leak scanner internals

Return safe categories.

## 51.4 Rule

Upload errors should be precise but not reveal security tooling details.

---

# 52. Audit Trail

Audit upload lifecycle:

- upload initiated;
- upload completed;
- file rejected;
- scan completed;
- file promoted;
- file downloaded;
- file deleted.

## 52.1 Fields

- actor;
- tenant;
- document ID;
- resource/case ID;
- original filename;
- detected type;
- size;
- checksum;
- decision;
- reason code;
- correlation ID.

## 52.2 Sensitive data

Do not log file content.

## 52.3 Rule

Upload audit is security evidence.

---

# 53. Observability

Upload has stages:

```text
request accepted
multipart parsed
stream copy started
bytes received
storage write
validation
scan queued
scan completed
metadata committed
```

## 53.1 Need visibility

- upload duration;
- bytes;
- rejected count;
- scanner latency;
- storage failures;
- client aborts;
- quota rejects.

## 53.2 Rule

Upload observability must cover both HTTP ingestion and asynchronous processing.

---

# 54. Metrics

Suggested metrics:

```text
upload_requests_total{route,result}
upload_bytes_total{route,document_type}
upload_duration_seconds{route,result}
upload_active_current{route}
upload_rejected_total{reason}
upload_storage_write_duration_seconds{storage}
upload_scan_queue_depth
upload_scan_duration_seconds{result}
upload_malware_detected_total{document_type}
upload_client_abort_total{route}
upload_quota_rejected_total{reason}
```

## 54.1 Avoid high-cardinality labels

Do not label by:

- filename;
- document ID;
- user ID;
- checksum.

## 54.2 Rule

Use reason/type labels, not raw identifiers.

---

# 55. Tracing

## 55.1 Span stages

- multipart parse;
- storage write;
- checksum compute;
- DB metadata;
- outbox publish;
- scanner call.

## 55.2 Large upload span

Long spans can be expensive.

Add events:

```text
upload.first_byte
upload.storage_written
upload.scan_queued
```

## 55.3 Rule

Trace key stages, not every chunk.

---

# 56. Logging

## 56.1 Log

- upload start/end;
- rejection reason;
- storage error;
- scan decision;
- quota exceeded;
- client abort.

## 56.2 Do not log

- raw file content;
- tokens;
- raw multipart body;
- suspicious payload bytes;
- sensitive metadata unless policy.

## 56.3 Filename

Log sanitized filename or hash if needed.

## 56.4 Rule

Upload logs must be safe under malicious input.

---

# 57. Testing Multipart Upload

## 57.1 Basic tests

- valid file;
- missing file part;
- missing metadata;
- duplicate file part;
- unknown part;
- wrong media type;
- invalid JSON metadata;
- multiple files.

## 57.2 Boundary tests

- weird boundary;
- empty file;
- zero-byte file allowed/rejected;
- filename absent;
- content type absent;
- repeated fields.

## 57.3 Rule

Test multipart contract, not only happy path file upload.

---

# 58. Testing File Security

## 58.1 Filename attacks

- `../evil.txt`;
- `C:\evil.txt`;
- CRLF;
- long filename;
- unicode confusable;
- double extension.

## 58.2 Type mismatch

- `.png` with HTML;
- `application/pdf` but text;
- polyglot where possible.

## 58.3 Malicious samples

Use safe test fixtures like EICAR for scanner integration where allowed.

## 58.4 Archives

- zip slip;
- zip bomb simulation;
- too many entries.

## 58.5 Rule

Security tests need malicious files and metadata.

---

# 59. Testing Large Uploads and Client Abort

## 59.1 Large file

Test file bigger than memory budget.

Assert no heap spike.

## 59.2 Limit exceed

Stream over max size and ensure partial storage cleanup.

## 59.3 Client abort

Close connection mid-upload.

Assert:

- temp file removed;
- metadata not committed or marked failed;
- metrics/audit record correct.

## 59.4 Rule

Large upload tests prove resource safety.

---

# 60. OpenAPI Documentation

## 60.1 Multipart request

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        type: object
        required:
          - metadata
          - file
        properties:
          metadata:
            type: string
            description: JSON metadata
          file:
            type: string
            format: binary
```

## 60.2 Document limits

- max file size;
- allowed types;
- max count;
- scan behavior;
- status lifecycle.

## 60.3 Document errors

- 400;
- 413;
- 415;
- 422;
- 429;
- 202/201 response.

## 60.4 Rule

Upload contract documentation must include security and lifecycle constraints.

---

# 61. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 61.1 Differences

- temp file threshold;
- memory buffering;
- streaming behavior;
- max request config;
- `EntityPart` support version;
- `@FormParam` multipart support;
- file name extraction;
- media type default;
- exception types.

## 61.2 Configure runtime

Do not rely only on application-level limits.

## 61.3 Test target runtime

Especially for large files.

## 61.4 Rule

Multipart is parser/runtime-sensitive; test your deployed stack.

---

# 62. Common Failure Modes

## 62.1 Trusting filename

Path traversal/overwrite.

## 62.2 Trusting Content-Type

Malicious content accepted.

## 62.3 Loading file into memory

OOM.

## 62.4 No size limits

Storage/DoS.

## 62.5 Serving upload from same origin inline

XSS risk.

## 62.6 No malware scan

Malware distribution.

## 62.7 Scan async but file downloadable before scan

Security bug.

## 62.8 DB metadata committed but object write failed

Broken resource.

## 62.9 Object stored but DB commit failed

Orphan storage.

## 62.10 Export/upload bypasses tenant policy

Data breach.

## 62.11 Unbounded scan queue

Operational outage.

## 62.12 No cleanup on client abort

Temp file leak.

---

# 63. Best Practices

## 63.1 Treat upload as untrusted bytes

Never trust metadata.

## 63.2 Use allowlists

Extensions, content types, document types.

## 63.3 Stream to quarantine

Do not publish immediately.

## 63.4 Enforce limits at multiple layers

Gateway, runtime, app, quota.

## 63.5 Generate storage keys

Never use original filename as path.

## 63.6 Scan before making available

Use async workflow if needed.

## 63.7 Store metadata in DB, bytes in object storage

Usually best architecture.

## 63.8 Use state machine

Pending, scanned, safe, rejected.

## 63.9 Audit lifecycle

Upload, scan, download, delete.

## 63.10 Test malicious inputs

Security tests are mandatory.

---

# 64. Anti-Patterns

## 64.1 `Files.write(uploadDir.resolve(filename), bytes)`

Path traversal + memory risk.

## 64.2 Denylist extensions

Incomplete.

## 64.3 `Content-Type` as authority

Client-controlled.

## 64.4 Upload directly into webroot

Critical risk.

## 64.5 Async scan but immediate download

Race vulnerability.

## 64.6 No quota

Storage exhaustion.

## 64.7 DB BLOB for huge files by default

Operational pain.

## 64.8 Logging multipart body

Data leak.

## 64.9 Accepting ZIP without extraction limits

Zip bomb/slip.

## 64.10 No contract for partial batch failure

Client confusion.

---

# 65. Production Checklist

## 65.1 Contract

- [ ] Required parts documented.
- [ ] Unknown part policy defined.
- [ ] Duplicate part policy defined.
- [ ] Max file size documented.
- [ ] Max request size configured.
- [ ] Max file count configured.
- [ ] Allowed document types documented.
- [ ] Allowed file types/extensions documented.
- [ ] Response lifecycle 201/202 documented.

## 65.2 Security

- [ ] Authentication required.
- [ ] Target resource authorization checked before reading full upload where possible.
- [ ] Tenant isolation enforced.
- [ ] Original filename sanitized.
- [ ] Server-generated storage key.
- [ ] Extension allowlist.
- [ ] Content-Type validation.
- [ ] Magic/signature detection.
- [ ] Malware scan/CDR policy.
- [ ] Quarantine before safe state.
- [ ] No inline serving of unsafe content.
- [ ] `nosniff` on downloads.

## 65.3 Resource management

- [ ] Streaming copy, no full memory load.
- [ ] Actual bytes counted.
- [ ] Partial temp object cleaned on failure.
- [ ] Client abort handled.
- [ ] Object/DB inconsistency cleanup job.
- [ ] Scan queue bounded.
- [ ] Quotas/rate limits.

## 65.4 Metadata/workflow

- [ ] Metadata validated.
- [ ] State machine modeled.
- [ ] Outbox event for scanning.
- [ ] Audit trail.
- [ ] Idempotency strategy.
- [ ] Checksum stored.
- [ ] Download blocked until safe.

## 65.5 Testing/observability

- [ ] Multipart contract tests.
- [ ] Large upload tests.
- [ ] Malicious filename tests.
- [ ] MIME mismatch tests.
- [ ] Scanner tests.
- [ ] Zip slip/bomb tests if archives allowed.
- [ ] Client abort tests.
- [ ] Metrics/logs/traces.

---

# 66. Latihan

## Latihan 1 — Basic EntityPart Upload

Buat endpoint:

```http
POST /documents
Content-Type: multipart/form-data
```

Parts:

```text
file
documentType
```

Return 202 with document status.

## Latihan 2 — Strict Parts

Gunakan `List<EntityPart>`.

Reject:

- unknown part;
- missing file;
- duplicate file;
- duplicate metadata.

## Latihan 3 — Streaming Copy

Stream file to temp directory/object storage.

Count bytes.

Reject when > 10 MiB.

Cleanup partial file.

## Latihan 4 — Filename Security

Test:

```text
../evil.txt
C:\temp\evil.txt
a\r\nX-Evil: yes.txt
laporan-é.pdf
```

Generate safe display name and server key.

## Latihan 5 — Type Validation

Accept only PDF.

Validate:

- extension `.pdf`;
- declared Content-Type;
- magic `%PDF-`.

Reject mismatch.

## Latihan 6 — Quarantine + Scan

Upload status:

```text
SCAN_PENDING
```

Scanner worker marks:

```text
SAFE
REJECTED_MALWARE
```

Download only SAFE.

## Latihan 7 — Object Storage State Machine

Simulate object write success but DB failure.

Cleanup orphan object.

Simulate DB success but scan failure.

Mark failed.

## Latihan 8 — Batch Upload

Upload 3 files.

One too large.

Define partial success response.

## Latihan 9 — Client Abort

Abort upload halfway.

Ensure temp file deleted and no metadata committed.

---

# 67. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `EntityPart` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/entitypart

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 — `MediaType.MULTIPART_FORM_DATA`  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/mediatype

4. RFC 7578 — Returning Values from Forms: multipart/form-data  
   https://www.rfc-editor.org/rfc/rfc7578.html

5. OWASP File Upload Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

6. OWASP Unrestricted File Upload  
   https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload

7. OWASP Web Security Testing Guide — Test Upload of Malicious Files  
   https://owasp.org/www-project-web-security-testing-guide/

8. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

---

# 68. Penutup

Multipart upload adalah area yang memadukan HTTP parsing, storage, security, domain workflow, dan operations.

Mental model final:

```text
multipart request
  ↓
strict part contract
  ↓
stream bytes with limits
  ↓
server-generated storage key
  ↓
validate metadata/type/extension/signature
  ↓
quarantine
  ↓
scan/CDR
  ↓
promote to safe
  ↓
metadata state transition
  ↓
download only through authorized safe endpoint
```

Prinsip final:

```text
Filename is metadata, not path.
Content-Type is hint, not truth.
Uploaded bytes are hostile until proven otherwise.
Object storage is not transactionally identical to database.
Scan status is part of resource lifecycle.
```

Top-tier JAX-RS engineer memastikan:

- `EntityPart` dipakai dengan contract yang ketat;
- file tidak dibaca penuh ke memory;
- size limit ada di gateway/runtime/app;
- extension/type/signature divalidasi;
- filename aman;
- file masuk quarantine dulu;
- scanning/CDR sesuai threat model;
- download diblok sampai safe;
- object storage dan DB metadata punya state machine;
- upload punya quota, audit, observability, dan malicious test suite.

Part berikutnya:

```text
Bagian 028 — JAX-RS Client API: Mental Model and Core Usage
```

Kita akan membahas client-side JAX-RS secara mendalam: `Client`, `WebTarget`, `Invocation.Builder`, request/response lifecycle, entity handling, timeouts, headers, cookies, providers, and safe resource management.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-026.md](./learn-jaxrs-advanced-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-028.md](./learn-jaxrs-advanced-part-028.md)
