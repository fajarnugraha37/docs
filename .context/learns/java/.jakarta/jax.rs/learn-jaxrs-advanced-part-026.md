# learn-jaxrs-advanced-part-026.md

# Bagian 026 — Streaming Responses: `StreamingOutput`, Chunking, Large Download, File Streaming, Range Requests, Backpressure, Error After Commit, Compression, Checksums, and Production-Safe Download APIs

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **streaming response** di JAX-RS/Jakarta REST secara production-grade. Fokus bagian ini bukan hanya “return `StreamingOutput`”, tetapi memahami HTTP response streaming, `OutputStream`, chunked transfer, `Content-Length`, file download headers, `Content-Disposition`, range requests, `206 Partial Content`, `Content-Range`, checksums, backpressure, blocking IO, error setelah response commit, gateway/proxy behavior, security, observability, dan desain API download yang aman untuk file besar/generated content.
>
> Namespace utama: `jakarta.ws.rs.core.StreamingOutput`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.core.MediaType`, `jakarta.ws.rs.core.HttpHeaders`, `jakarta.ws.rs.core.EntityTag`, `jakarta.ws.rs.core.Request`, `java.io.OutputStream`, `java.nio.file.Files`, `java.nio.channels.FileChannel`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Streaming Response adalah Progressive Writing ke HTTP Body](#2-mental-model-streaming-response-adalah-progressive-writing-ke-http-body)
3. [StreamingOutput: Apa dan Kapan Digunakan](#3-streamingoutput-apa-dan-kapan-digunakan)
4. [StreamingOutput vs `MessageBodyWriter`](#4-streamingoutput-vs-messagebodywriter)
5. [StreamingOutput vs Return `File`/`Path`/`byte[]`](#5-streamingoutput-vs-return-filepathbyte)
6. [Basic `StreamingOutput` Example](#6-basic-streamingoutput-example)
7. [Response with `StreamingOutput`](#7-response-with-streamingoutput)
8. [Resource Method Return Types](#8-resource-method-return-types)
9. [OutputStream Lifecycle](#9-outputstream-lifecycle)
10. [Do You Need to Close OutputStream?](#10-do-you-need-to-close-outputstream)
11. [Buffering Strategy](#11-buffering-strategy)
12. [Flush Strategy](#12-flush-strategy)
13. [Content-Length vs Chunked Transfer](#13-content-length-vs-chunked-transfer)
14. [HTTP/1.1 Chunked Transfer Mental Model](#14-http11-chunked-transfer-mental-model)
15. [HTTP/2 Streaming Mental Model](#15-http2-streaming-mental-model)
16. [When to Set `Content-Length`](#16-when-to-set-content-length)
17. [When Not to Set `Content-Length`](#17-when-not-to-set-content-length)
18. [Large File Download Design](#18-large-file-download-design)
19. [Generated Content Streaming](#19-generated-content-streaming)
20. [CSV Export Streaming](#20-csv-export-streaming)
21. [JSON Streaming: NDJSON vs Huge JSON Array](#21-json-streaming-ndjson-vs-huge-json-array)
22. [Streaming from Database Cursor](#22-streaming-from-database-cursor)
23. [Transaction Boundary for Streaming](#23-transaction-boundary-for-streaming)
24. [Streaming from Object Storage](#24-streaming-from-object-storage)
25. [Content-Disposition and Filename](#25-content-disposition-and-filename)
26. [`filename` vs `filename*`](#26-filename-vs-filename)
27. [Content-Type and MIME Safety](#27-content-type-and-mime-safety)
28. [X-Content-Type-Options](#28-x-content-type-options)
29. [Cache-Control for Downloads](#29-cache-control-for-downloads)
30. [ETag and Last-Modified for Downloads](#30-etag-and-last-modified-for-downloads)
31. [Range Requests Overview](#31-range-requests-overview)
32. [`Accept-Ranges`](#32-accept-ranges)
33. [`Range` Request Header](#33-range-request-header)
34. [`206 Partial Content`](#34-206-partial-content)
35. [`Content-Range`](#35-content-range)
36. [`416 Range Not Satisfiable`](#36-416-range-not-satisfiable)
37. [`If-Range`](#37-if-range)
38. [Single Range vs Multiple Range](#38-single-range-vs-multiple-range)
39. [Implementing Single Byte Range](#39-implementing-single-byte-range)
40. [Range Request Security and Abuse](#40-range-request-security-and-abuse)
41. [Backpressure: Slow Client Problem](#41-backpressure-slow-client-problem)
42. [Blocking IO and Thread Consumption](#42-blocking-io-and-thread-consumption)
43. [Async/Reactive Streaming Caveat](#43-asyncreactive-streaming-caveat)
44. [Error Before Commit vs Error After Commit](#44-error-before-commit-vs-error-after-commit)
45. [Exception Mapping Limitations](#45-exception-mapping-limitations)
46. [Client Disconnect / Broken Pipe](#46-client-disconnect--broken-pipe)
47. [Checksum and Digest Headers](#47-checksum-and-digest-headers)
48. [Compression and Streaming](#48-compression-and-streaming)
49. [Streaming ZIP Archives](#49-streaming-zip-archives)
50. [Temporary Files vs Direct Streaming](#50-temporary-files-vs-direct-streaming)
51. [Memory Safety](#51-memory-safety)
52. [Security and Authorization](#52-security-and-authorization)
53. [Tenant/Data Authorization for Exports](#53-tenantdata-authorization-for-exports)
54. [Rate Limiting and Quotas](#54-rate-limiting-and-quotas)
55. [Audit Trail for Downloads](#55-audit-trail-for-downloads)
56. [Observability](#56-observability)
57. [Metrics](#57-metrics)
58. [Tracing](#58-tracing)
59. [Logging](#59-logging)
60. [Testing Streaming Responses](#60-testing-streaming-responses)
61. [Testing Large Files](#61-testing-large-files)
62. [Testing Range Requests](#62-testing-range-requests)
63. [Testing Client Disconnect](#63-testing-client-disconnect)
64. [OpenAPI Documentation](#64-openapi-documentation)
65. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#65-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
66. [Gateway/CDN/Reverse Proxy Notes](#66-gatewaycdnreverse-proxy-notes)
67. [Common Failure Modes](#67-common-failure-modes)
68. [Best Practices](#68-best-practices)
69. [Anti-Patterns](#69-anti-patterns)
70. [Production Checklist](#70-production-checklist)
71. [Latihan](#71-latihan)
72. [Referensi Resmi](#72-referensi-resmi)
73. [Penutup](#73-penutup)

---

# 1. Tujuan Part Ini

Banyak REST endpoint mengembalikan JSON kecil.

Namun production systems sering butuh mengirim response besar:

- PDF certificate;
- uploaded document;
- CSV export;
- Excel export;
- ZIP bundle;
- audit log export;
- generated report;
- large media;
- object storage file;
- backup/archive file.

Naive implementation:

```java
byte[] bytes = Files.readAllBytes(path);
return Response.ok(bytes).build();
```

Bermasalah jika file besar:

- memory tinggi;
- GC pressure;
- response baru mulai setelah semua data siap;
- client disconnect tidak terdeteksi awal;
- tidak mendukung resume download;
- tidak ada `Content-Disposition`;
- tidak ada `Content-Length`;
- tidak ada range request;
- audit dan authorization sering salah;
- error setelah response commit tidak bisa jadi Problem Details normal.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memakai `StreamingOutput` dengan benar;
- memilih antara `StreamingOutput`, `File`, `Path`, `byte[]`, dan `MessageBodyWriter`;
- mendesain file download headers;
- memahami chunked transfer vs `Content-Length`;
- implement range request single byte range;
- mengelola error after commit;
- menangani client disconnect;
- menghindari memory blow-up;
- menulis streaming CSV/NDJSON;
- mengamankan download/export;
- menguji streaming secara realistis.

## 1.2 Prinsip utama

```text
Streaming response is not just about large output.
It is about controlling memory, latency, protocol metadata, and failure semantics.
```

---

# 2. Mental Model: Streaming Response adalah Progressive Writing ke HTTP Body

Normal buffered response:

```text
build full entity in memory
  ↓
runtime serializes entity
  ↓
send response body
```

Streaming response:

```text
send headers
  ↓
write body progressively to OutputStream
  ↓
flush chunks as data becomes available
  ↓
complete stream or fail connection
```

## 2.1 Why streaming?

Streaming helps:

- avoid loading entire payload into memory;
- start sending earlier;
- support generated output;
- pipe data from file/object store/DB to client;
- reduce peak heap;
- avoid huge byte arrays.

## 2.2 What streaming does not solve

Streaming does not automatically solve:

- slow client backpressure;
- database transaction lifetime;
- retry/resume;
- error after commit;
- gateway buffering;
- authorization;
- range support;
- checksum correctness.

## 2.3 Top-tier rule

```text
Once response body starts, your ability to change HTTP status/error contract is mostly gone.
Design streaming preconditions before writing bytes.
```

---

# 3. StreamingOutput: Apa dan Kapan Digunakan

`StreamingOutput` is a JAX-RS interface used when application wants to stream output directly.

## 3.1 Interface

```java
public interface StreamingOutput {
    void write(OutputStream output) throws IOException, WebApplicationException;
}
```

## 3.2 Use as return value

```java
@GET
public StreamingOutput download() {
    return output -> { ... };
}
```

## 3.3 Use as Response entity

```java
return Response.ok((StreamingOutput) output -> { ... })
    .type("text/csv")
    .build();
```

## 3.4 Good use cases

- CSV generation;
- large file copying;
- ZIP generation;
- object storage streaming;
- database cursor export;
- custom binary format.

## 3.5 Rule

Use `StreamingOutput` when you need direct control over response body writing.

---

# 4. StreamingOutput vs `MessageBodyWriter`

## 4.1 StreamingOutput

Per-endpoint callback.

```java
StreamingOutput output = os -> exportService.writeCsv(os, query);
```

Good for one-off custom streaming.

## 4.2 MessageBodyWriter

Reusable provider for a Java type.

```java
@Provider
@Produces("text/csv")
public class CsvReportWriter implements MessageBodyWriter<CsvReport> { ... }
```

Good when many endpoints return same streamable type.

## 4.3 Selection

`StreamingOutput` is lightweight alternative to `MessageBodyWriter`.

## 4.4 Rule

Use `StreamingOutput` for endpoint-specific streaming; use `MessageBodyWriter` for reusable entity serialization contract.

---

# 5. StreamingOutput vs Return `File`/`Path`/`byte[]`

## 5.1 `byte[]`

Good for small known payloads.

Bad for large files.

## 5.2 `File`/`Path`

Some runtimes have efficient file support.

Potentially simpler for static local files.

But portability/provider behavior differs.

## 5.3 `StreamingOutput`

Portable direct control.

You decide:

- headers;
- buffering;
- range;
- source;
- error handling.

## 5.4 `InputStream`

Some runtimes can stream `InputStream`, but lifecycle/close handling must be verified.

## 5.5 Rule

For large/generated payloads, avoid `byte[]`; choose `StreamingOutput` or runtime-supported file streaming.

---

# 6. Basic `StreamingOutput` Example

```java
@GET
@Path("/hello.txt")
@Produces("text/plain")
public StreamingOutput hello() {
    return output -> {
        output.write("hello\n".getBytes(StandardCharsets.UTF_8));
    };
}
```

This works, but production needs:

- content type;
- length if known;
- disposition if download;
- error handling;
- charset;
- security;
- observability.

## 6.1 With Response

```java
@GET
@Path("/hello.txt")
public Response hello() {
    StreamingOutput stream = output -> {
        output.write("hello\n".getBytes(StandardCharsets.UTF_8));
    };

    return Response.ok(stream)
        .type("text/plain; charset=utf-8")
        .header("Content-Disposition", "attachment; filename=\"hello.txt\"")
        .build();
}
```

## 6.2 Rule

Always wrap streaming output in response when headers matter.

---

# 7. Response with `StreamingOutput`

## 7.1 File response

```java
@GET
@Path("/documents/{id}/download")
public Response download(@PathParam("id") DocumentId id) {
    DocumentFile file = documentService.authorizeAndGetFile(id, currentActor());

    StreamingOutput body = output -> {
        try (InputStream input = file.openStream()) {
            input.transferTo(output);
        }
    };

    return Response.ok(body)
        .type(file.mediaType())
        .header("Content-Length", file.size())
        .header("Content-Disposition", contentDispositionAttachment(file.downloadName()))
        .tag(new EntityTag(file.etag()))
        .lastModified(Date.from(file.lastModified()))
        .build();
}
```

## 7.2 Precompute metadata before streaming

Before returning response:

- authorize;
- locate file;
- get size;
- get media type;
- validate range/preconditions;
- prepare audit record if needed.

## 7.3 Rule

Headers and status must be decided before streaming begins.

---

# 8. Resource Method Return Types

## 8.1 Direct StreamingOutput

```java
public StreamingOutput export()
```

Simple but limited header control unless annotations enough.

## 8.2 Response entity

```java
public Response export()
```

Recommended for downloads.

## 8.3 CompletionStage<Response>

For async preparation.

```java
public CompletionStage<Response> export()
```

But actual body streaming still happens when response is written.

## 8.4 AsyncResponse + StreamingOutput

Possible but complex.

Use only when preparation itself is async or long-polling style.

## 8.5 Rule

Use `Response` for streaming APIs with protocol metadata.

---

# 9. OutputStream Lifecycle

`StreamingOutput#write(OutputStream)` is called by runtime when writing entity body.

## 9.1 Who owns OutputStream?

The JAX-RS runtime/container owns response OutputStream.

Application writes to it.

## 9.2 Do not store OutputStream

Bad:

```java
this.output = output;
```

The stream is valid only during write callback.

## 9.3 Write and return

When `write` returns successfully, response body is complete.

## 9.4 Exceptions

Throwing `IOException` may abort connection if response already committed.

## 9.5 Rule

Treat OutputStream as callback-scoped resource.

---

# 10. Do You Need to Close OutputStream?

Usually no.

## 10.1 Do not close runtime output stream casually

Runtime manages it.

Closing it may be okay in some containers but can interfere with runtime.

## 10.2 Close your source stream

```java
try (InputStream in = file.openStream()) {
    in.transferTo(output);
}
```

## 10.3 Flush?

Use flush carefully.

## 10.4 Rule

Close sources you open; let runtime manage response OutputStream.

---

# 11. Buffering Strategy

## 11.1 Use buffer

```java
byte[] buffer = new byte[64 * 1024];

int read;
while ((read = input.read(buffer)) != -1) {
    output.write(buffer, 0, read);
}
```

## 11.2 Buffer size

Common range:

```text
8 KiB – 128 KiB
```

Tune based on source/network/runtime.

## 11.3 Avoid one-byte writes

Very inefficient.

## 11.4 Avoid huge per-request buffers

If thousands of downloads, 1 MiB buffer each is costly.

## 11.5 Rule

Use moderate buffer and measure.

---

# 12. Flush Strategy

## 12.1 Flush sends buffered data downstream

```java
output.flush();
```

## 12.2 Too frequent flush

Can hurt throughput.

## 12.3 When useful

- progress streaming;
- NDJSON streaming;
- heartbeat-like text stream;
- early client delivery needed.

## 12.4 File download

Usually no need to flush after every chunk.

## 12.5 Rule

Flush intentionally; do not flush every write by habit.

---

# 13. Content-Length vs Chunked Transfer

HTTP response body length can be known or unknown.

## 13.1 Known length

```http
Content-Length: 104857600
```

Good for files/object storage with known size.

## 13.2 Unknown length

Server may stream without content length.

In HTTP/1.1, transfer can use chunked encoding.

## 13.3 Client UX

Content-Length enables progress bar.

## 13.4 Intermediaries

Some proxies behave better when length known.

## 13.5 Rule

Set Content-Length when correct and cheap; omit when generated length is unknown.

---

# 14. HTTP/1.1 Chunked Transfer Mental Model

When content length unknown and connection persists, HTTP/1.1 can use chunked transfer coding.

Conceptually:

```text
chunk-size
chunk-data
chunk-size
chunk-data
0
```

## 14.1 Application usually does not create chunks

Container/runtime handles transfer coding.

You just write bytes.

## 14.2 Chunk boundaries are not application records

Client should not rely on chunk boundaries.

## 14.3 Rule

Chunked transfer is transport framing, not application protocol.

---

# 15. HTTP/2 Streaming Mental Model

HTTP/2 does not use HTTP/1.1 chunked transfer coding.

It uses DATA frames.

## 15.1 Application code same

`OutputStream` write.

## 15.2 Intermediary behavior different

Flow control and buffering can differ.

## 15.3 Rule

Do not build application semantics on HTTP/1.1 chunk boundaries.

---

# 16. When to Set `Content-Length`

Set when:

- file size known;
- byte range length known;
- generated into temp file first;
- object metadata gives exact length;
- response not compressed/transformed after length.

## 16.1 Benefits

- progress;
- resume logic;
- client resource planning;
- some proxies/caches.

## 16.2 Be accurate

Wrong Content-Length breaks response.

## 16.3 Compression caveat

If gateway compresses, entity length changes unless compression layer handles headers.

## 16.4 Rule

Never guess Content-Length.

---

# 17. When Not to Set `Content-Length`

Do not set when:

- streaming generated content without precompute;
- compression changes length;
- response may abort/short-write;
- content is transformed by interceptor/gateway;
- multi-part boundary generated dynamically and length unknown.

## 17.1 Let runtime handle transfer framing

Omit content length.

## 17.2 Rule

Unknown length is acceptable; incorrect length is not.

---

# 18. Large File Download Design

## 18.1 Steps

```text
1. Authenticate
2. Authorize document access
3. Resolve file/object metadata
4. Evaluate conditional headers
5. Parse Range if supported
6. Build response headers
7. Stream bytes
8. Audit completion/failure
```

## 18.2 Headers

```http
Content-Type: application/pdf
Content-Length: 1234567
Content-Disposition: attachment; filename="document.pdf"; filename*=UTF-8''document.pdf
ETag: "doc-D001-v3"
Last-Modified: Fri, 12 Jun 2026 08:00:00 GMT
Accept-Ranges: bytes
Cache-Control: private, no-cache
```

## 18.3 Avoid direct public path exposure

Do not map file system paths from URL.

## 18.4 Rule

Download endpoint is a security boundary, not static file server by default.

---

# 19. Generated Content Streaming

Generated content examples:

- CSV export;
- dynamic report;
- ZIP archive;
- NDJSON feed.

## 19.1 No Content-Length

Often length unknown until generation complete.

## 19.2 Need failure strategy

If generation fails after bytes sent, client gets broken download, not Problem Details.

## 19.3 Preflight validation

Validate all inputs and permissions before first byte.

## 19.4 Consider async job

For long generation, prefer:

```text
POST /exports → 202
GET /exports/{id}/download
```

## 19.5 Rule

Do not stream long fragile generation directly if it should be durable/retryable.

---

# 20. CSV Export Streaming

## 20.1 Example

```java
StreamingOutput csv = output -> {
    try (Writer writer = new BufferedWriter(
        new OutputStreamWriter(output, StandardCharsets.UTF_8)
    )) {
        writer.write("id,name,status\n");

        exportService.streamRows(query, row -> {
            writer.write(csv(row.id()));
            writer.write(",");
            writer.write(csv(row.name()));
            writer.write(",");
            writer.write(csv(row.status()));
            writer.write("\n");
        });

        writer.flush();
    }
};
```

## 20.2 CSV injection

Values starting with:

```text
= + - @
```

can be spreadsheet formula injection.

Escape/sanitize according policy.

## 20.3 Charset

Use UTF-8.

Optionally BOM if Excel compatibility required.

## 20.4 Rule

CSV export needs security treatment, not just comma joining.

---

# 21. JSON Streaming: NDJSON vs Huge JSON Array

## 21.1 Huge JSON array

```json
[
  { ... },
  { ... }
]
```

Challenges:

- if error halfway, JSON invalid;
- need commas correctly;
- client often waits for full array to parse;
- not ideal for infinite/large stream.

## 21.2 NDJSON

One JSON object per line:

```text
{"id":"1"}
{"id":"2"}
```

Media type often:

```text
application/x-ndjson
```

or documented custom.

## 21.3 Pros

- incremental parsing;
- line-by-line processing;
- easier partial processing.

## 21.4 Rule

For large streaming records, consider NDJSON instead of one huge JSON array.

---

# 22. Streaming from Database Cursor

## 22.1 Problem

Naive:

```java
List<Row> rows = repository.findAll();
```

Loads everything.

## 22.2 Cursor/streaming query

Use DB cursor/fetch size/streaming result set.

## 22.3 Transaction issue

DB cursor may require open transaction/connection while streaming.

Long stream can hold DB resources for minutes.

## 22.4 Safer alternatives

- export job writes temp/object file then download;
- pagination;
- chunked job processing;
- database COPY/export feature;
- snapshot table.

## 22.5 Rule

Streaming directly from DB to HTTP couples client speed to DB resource lifetime.

---

# 23. Transaction Boundary for Streaming

## 23.1 Bad

```text
open transaction
stream to slow client for 10 minutes
commit
```

Risks:

- locks;
- connection held;
- transaction timeout;
- inconsistent partial output;
- rollback impossible after bytes sent.

## 23.2 Better

- validate query;
- create export snapshot/job;
- commit;
- stream generated file;
- delete temp file later.

## 23.3 For short exports

If direct DB streaming is acceptable, set timeouts and fetch size carefully.

## 23.4 Rule

Do not hold important transactional resources open for unbounded client download time.

---

# 24. Streaming from Object Storage

## 24.1 App proxy streaming

App authorizes then streams object to client.

Pros:

- app controls audit/security;
- no pre-signed URL exposed.

Cons:

- app bandwidth cost;
- app threads/connections occupied.

## 24.2 Pre-signed URL

App authorizes then returns short-lived URL.

Pros:

- offloads bandwidth;
- object storage handles range/resume.

Cons:

- URL leakage risk;
- less app control;
- audit must be handled.

## 24.3 Hybrid

Internal downloads proxied; large public files presigned.

## 24.4 Rule

Choose proxy vs pre-signed URL based on security, audit, bandwidth, and compliance.

---

# 25. Content-Disposition and Filename

`Content-Disposition` tells user agent how to process payload and can provide filename.

## 25.1 Attachment

```http
Content-Disposition: attachment; filename="report.csv"
```

## 25.2 Inline

```http
Content-Disposition: inline; filename="document.pdf"
```

## 25.3 Security

Filename is advisory.

Clients must not trust it as safe path.

Server should sanitize to avoid header injection and confusing filenames.

## 25.4 Rule

Use Content-Disposition for downloads, but generate it carefully.

---

# 26. `filename` vs `filename*`

## 26.1 `filename`

Legacy/basic parameter.

```http
filename="report.csv"
```

## 26.2 `filename*`

Extended parameter for internationalized filenames.

```http
filename*=UTF-8''laporan%20bulan%20juni.csv
```

## 26.3 Recommended

Send both:

```http
Content-Disposition: attachment; filename="report.csv"; filename*=UTF-8''laporan%20juni.csv
```

## 26.4 Avoid raw user input

Sanitize and encode.

## 26.5 Rule

Use RFC-compatible filename handling, especially for non-ASCII filenames.

---

# 27. Content-Type and MIME Safety

## 27.1 Set correct type

```http
Content-Type: application/pdf
Content-Type: text/csv; charset=utf-8
Content-Type: application/zip
```

## 27.2 Unknown binary

```http
application/octet-stream
```

## 27.3 Do not trust uploaded MIME type

Store detected/validated media type.

## 27.4 Browser risk

Wrong content type can lead to inline rendering/security issues.

## 27.5 Rule

Content-Type is security and UX metadata.

---

# 28. X-Content-Type-Options

For browser-facing downloads:

```http
X-Content-Type-Options: nosniff
```

## 28.1 Why

Prevents browser MIME sniffing.

## 28.2 Use with accurate Content-Type

Do both.

## 28.3 Rule

Set `nosniff` for untrusted/user-uploaded downloadable content.

---

# 29. Cache-Control for Downloads

## 29.1 Sensitive downloads

```http
Cache-Control: no-store
```

## 29.2 User-specific but cacheable in browser

```http
Cache-Control: private, no-cache
```

## 29.3 Public immutable files

```http
Cache-Control: public, max-age=31536000, immutable
```

only if truly immutable and safe.

## 29.4 Rule

Download cache policy depends on sensitivity, authorization, and mutability.

---

# 30. ETag and Last-Modified for Downloads

## 30.1 Use validators

```http
ETag: "doc-D001-v3"
Last-Modified: Fri, 12 Jun 2026 08:00:00 GMT
```

## 30.2 Benefits

- cache revalidation;
- range request `If-Range`;
- resume correctness;
- client cache efficiency.

## 30.3 Strong ETag

Use strong ETag for byte-identical file content.

## 30.4 Rule

File downloads benefit strongly from validators.

---

# 31. Range Requests Overview

Range requests let client request part of a representation.

Example:

```http
Range: bytes=0-1023
```

Use cases:

- resume interrupted download;
- media seeking;
- partial retrieval;
- download managers.

## 31.1 Server opt-in

Server can advertise:

```http
Accept-Ranges: bytes
```

## 31.2 Partial response

```http
206 Partial Content
Content-Range: bytes 0-1023/10000
Content-Length: 1024
```

## 31.3 Rule

Implement Range only if you can do it correctly.

---

# 32. `Accept-Ranges`

Header:

```http
Accept-Ranges: bytes
```

Means server supports byte range requests for target resource.

## 32.1 No support

```http
Accept-Ranges: none
```

or omit.

## 32.2 Do not advertise if unsupported

Clients may rely on it.

## 32.3 Rule

Only send `Accept-Ranges: bytes` when range behavior works.

---

# 33. `Range` Request Header

## 33.1 Forms

```http
Range: bytes=0-499
Range: bytes=500-
Range: bytes=-500
```

## 33.2 Meaning

- `0-499`: first 500 bytes.
- `500-`: from byte 500 to end.
- `-500`: last 500 bytes.

## 33.3 Multiple ranges

```http
Range: bytes=0-99,200-299
```

More complex because multipart/byteranges response needed.

## 33.4 Rule

Start with single range support; reject/ignore multiple ranges intentionally.

---

# 34. `206 Partial Content`

When server fulfills range request:

```http
206 Partial Content
Content-Range: bytes 0-499/1234
Content-Length: 500
```

## 34.1 Body

Contains only requested bytes.

## 34.2 Content-Type

Same as full representation or multipart for multiple ranges.

## 34.3 ETag

Include validators when available.

## 34.4 Rule

206 must include correct Content-Range for byte range responses.

---

# 35. `Content-Range`

Format:

```http
Content-Range: bytes start-end/complete-length
```

Example:

```http
Content-Range: bytes 0-499/1234
```

## 35.1 Unknown length

Sometimes:

```http
Content-Range: bytes 0-499/*
```

But downloads usually know length.

## 35.2 Unsatisfied range

```http
Content-Range: bytes */1234
```

with 416.

## 35.3 Rule

Content-Range is mandatory for correct partial content.

---

# 36. `416 Range Not Satisfiable`

If requested range cannot be satisfied:

```http
416 Range Not Satisfiable
Content-Range: bytes */1234
```

## 36.1 Example

File length 1000.

Client:

```http
Range: bytes=2000-3000
```

Server returns 416.

## 36.2 Rule

Invalid/unsatisfiable ranges need clear 416 response.

---

# 37. `If-Range`

Client can ask:

```http
If-Range: "etag"
Range: bytes=1000-
```

If resource unchanged, server sends 206.

If changed, server sends 200 full representation.

## 37.1 Use case

Resume download only if file same.

## 37.2 Strong validator

Use strong ETag or date validator as allowed by HTTP semantics.

## 37.3 Rule

Implement If-Range if supporting robust resume downloads.

---

# 38. Single Range vs Multiple Range

## 38.1 Single range

Simpler:

```http
Range: bytes=0-1023
```

Response body raw bytes.

## 38.2 Multiple range

Requires:

```http
Content-Type: multipart/byteranges; boundary=...
```

with each part having Content-Range.

## 38.3 Many APIs choose not to support multi-range

They can ignore Range and return 200, or reject if policy.

Be careful with spec/client expectations.

## 38.4 Security

Multiple ranges can be abused.

## 38.5 Rule

Support single range first; document multi-range policy.

---

# 39. Implementing Single Byte Range

## 39.1 Range model

```java
record ByteRange(long start, long endInclusive) {
    long length() {
        return endInclusive - start + 1;
    }
}
```

## 39.2 Parse

```java
Optional<ByteRange> range = rangeParser.parseSingle(rangeHeader, fileSize);
```

## 39.3 Response

```java
StreamingOutput body = out -> {
    try (InputStream in = file.openStream()) {
        skipFully(in, range.start());
        copyLimited(in, out, range.length());
    }
};

return Response.status(Response.Status.PARTIAL_CONTENT)
    .entity(body)
    .type(file.mediaType())
    .header("Content-Range", "bytes " + start + "-" + end + "/" + fileSize)
    .header("Content-Length", range.length())
    .header("Accept-Ranges", "bytes")
    .build();
```

## 39.4 FileChannel

For local files, `FileChannel.position(start)` can be more efficient.

## 39.5 Rule

Range implementation must be exact and heavily tested.

---

# 40. Range Request Security and Abuse

## 40.1 Abuse vectors

- many tiny ranges;
- overlapping ranges;
- huge number of range headers;
- expensive seek source;
- range on generated content;
- bypassing quota by partial repeated downloads.

## 40.2 Defenses

- support only single range;
- max range count;
- min/max range length if needed;
- rate limit;
- auth before range;
- audit total bytes;
- reject weird syntax.

## 40.3 Rule

Range is powerful but expands attack surface.

---

# 41. Backpressure: Slow Client Problem

When client is slow, writes may block.

## 41.1 Blocking stream

`output.write(...)` may block.

## 41.2 Consequence

Request/output thread occupied.

Source resources held longer.

## 41.3 Do not read source too far ahead

Avoid buffering entire source in app memory.

## 41.4 Rule

Streaming naturally applies some backpressure by blocking writes, but you must account for resource occupancy.

---

# 42. Blocking IO and Thread Consumption

`StreamingOutput` is often blocking.

## 42.1 For each active streaming response

A container thread or worker may be occupied while writing.

## 42.2 Large concurrent downloads

Can exhaust threads/connections/bandwidth.

## 42.3 Mitigate

- limit concurrent downloads;
- offload to object storage/CDN;
- use async/non-blocking runtime if appropriate;
- bandwidth quotas;
- separate download service.

## 42.4 Rule

Streaming saves memory, not necessarily threads.

---

# 43. Async/Reactive Streaming Caveat

Do not confuse:

- `StreamingOutput`: blocking callback writing bytes.
- SSE: event stream protocol.
- reactive streams: non-blocking/backpressure API.
- servlet async: request thread release.

## 43.1 Reactive runtime

Some runtimes provide reactive types for streaming.

## 43.2 Use appropriately

If using event-loop runtime, do not block event loop with file IO.

## 43.3 Rule

Understand runtime threading model.

---

# 44. Error Before Commit vs Error After Commit

## 44.1 Before commit

You can return normal error response:

```http
404
403
416
500
```

with Problem Details.

## 44.2 After commit

If bytes already sent, you cannot change status to 500 with JSON body.

The connection may close abruptly.

## 44.3 Example

CSV generation fails at row 10,000.

Client gets partial file.

## 44.4 Strategies

- validate before first byte;
- generate to temp file first;
- use async job;
- include checksums;
- client verifies file completeness;
- audit failed download.

## 44.5 Rule

Streaming shifts some failures from HTTP error contract to transport failure.

---

# 45. Exception Mapping Limitations

`StreamingOutput.write` may throw:

- `IOException`;
- `WebApplicationException`.

## 45.1 Before bytes written

`WebApplicationException` may still produce error response.

## 45.2 After bytes written

Status likely committed; mapper cannot produce clean Problem Details.

## 45.3 Avoid throwing business exceptions mid-stream

Perform business validation before streaming.

## 45.4 Rule

Exception mappers are less useful after response body begins.

---

# 46. Client Disconnect / Broken Pipe

Client may cancel download.

## 46.1 Symptoms

- `IOException`;
- broken pipe;
- connection reset.

## 46.2 Not always error

Client cancel is normal operational event.

## 46.3 Logging

Log at debug/info with reason, not error spam.

## 46.4 Cleanup

Close source stream.

Release temp resources.

## 46.5 Rule

Treat client disconnect as expected lifecycle, not always incident.

---

# 47. Checksum and Digest Headers

Checksums help client verify downloaded content.

## 47.1 Options

- custom header like `X-Checksum-SHA256`;
- standardized digest-related headers depending client support;
- checksum file sidecar.

## 47.2 For known files

Precompute checksum and return header.

## 47.3 For generated stream

Checksum known only after generation unless precompute/temp file.

## 47.4 Rule

If integrity matters, provide checksum or signed artifact.

---

# 48. Compression and Streaming

## 48.1 Compressible

CSV, JSON, text.

## 48.2 Already compressed

ZIP, PDF, images often not worth recompressing.

## 48.3 Compression can buffer

Some compression filters buffer before emitting data.

## 48.4 Content-Length

Compressed length may be unknown.

## 48.5 ETag

Compression affects strong ETag semantics.

## 48.6 Rule

Coordinate compression with Content-Length, ETag, and streaming latency.

---

# 49. Streaming ZIP Archives

## 49.1 Example

```java
StreamingOutput zip = output -> {
    try (ZipOutputStream zipOut = new ZipOutputStream(output)) {
        for (Document doc : docs) {
            ZipEntry entry = new ZipEntry(safeZipEntryName(doc.name()));
            zipOut.putNextEntry(entry);
            try (InputStream in = doc.openStream()) {
                in.transferTo(zipOut);
            }
            zipOut.closeEntry();
        }
        zipOut.finish();
    }
};
```

## 49.2 Security

- zip slip: sanitize entry names;
- avoid absolute paths;
- avoid `../`;
- control total uncompressed size;
- avoid huge number of files.

## 49.3 Error after commit

If document read fails mid-ZIP, archive may be corrupt.

For critical archives, generate temp ZIP first.

## 49.4 Rule

Streaming ZIP is convenient but harder to make failure-proof.

---

# 50. Temporary Files vs Direct Streaming

## 50.1 Direct streaming

Pros:

- low storage;
- starts quickly;
- low memory.

Cons:

- mid-stream failure risk;
- no content length/checksum;
- resource tied to client speed.

## 50.2 Temp file

Pros:

- validate/generate fully first;
- content length known;
- checksum possible;
- retries/range easier;
- failure before download.

Cons:

- disk/object storage needed;
- cleanup lifecycle;
- delayed first byte.

## 50.3 Rule

Use temp/object file for large critical generated downloads.

---

# 51. Memory Safety

## 51.1 Avoid

```java
ByteArrayOutputStream all = new ByteArrayOutputStream();
```

for large payload.

## 51.2 Stream row-by-row/chunk-by-chunk

Do not collect all data.

## 51.3 Limit concurrent streams

Memory per stream multiplied by concurrency.

## 51.4 Rule

Streaming design must have bounded memory per request.

---

# 52. Security and Authorization

## 52.1 Authorize before streaming

Do not start writing bytes before access check complete.

## 52.2 Re-check file ownership/tenant

File ID alone is not enough.

## 52.3 Signed URL

If using pre-signed URL, make short-lived and scoped.

## 52.4 Filename security

Sanitize filename.

Prevent CRLF header injection.

## 52.5 Content sniffing

Set accurate type and `nosniff`.

## 52.6 Rule

Download endpoint is high-value exfiltration surface.

---

# 53. Tenant/Data Authorization for Exports

Exports are dangerous.

## 53.1 List authorization applies

If user can list only tenant T1 rows, export must include only T1 rows.

## 53.2 Filter enforcement

Do not trust query tenant parameter.

## 53.3 Field-level authorization

Export may include fields not shown in UI.

Apply same or stricter policy.

## 53.4 Audit

Record who exported what scope.

## 53.5 Rule

Export APIs are data leak hotspots.

---

# 54. Rate Limiting and Quotas

## 54.1 Why

Downloads consume:

- bandwidth;
- threads;
- object storage egress;
- DB resources;
- CPU for generation/compression.

## 54.2 Limits

- concurrent downloads per user/tenant;
- bytes per day;
- export rows per request;
- request rate;
- max file size;
- max date range.

## 54.3 Response

```http
429 Too Many Requests
Retry-After: 60
```

or 403 quota exceeded depending policy.

## 54.4 Rule

Large downloads need quota controls.

---

# 55. Audit Trail for Downloads

Audit should include:

- actor;
- tenant;
- document/export ID;
- filters/date range;
- byte count if known;
- start time;
- completion/failure;
- client IP if trusted;
- correlation ID.

## 55.1 Completion audit

Hard because client disconnect may happen mid-stream.

Track:

```text
started
completed
failed
client_aborted
```

## 55.2 Sensitive values

Do not log raw query with PII unless policy allows.

## 55.3 Rule

Audit download intent and result.

---

# 56. Observability

Streaming has stages:

```text
authorize
prepare metadata
start response
first byte
bytes sent
completion/failure
```

## 56.1 Important indicators

- time to first byte;
- total stream duration;
- bytes sent;
- failure after commit;
- client aborts;
- active streams;
- source read latency;
- write latency.

## 56.2 Rule

Observe both application generation and network streaming behavior.

---

# 57. Metrics

Suggested metrics:

```text
download_requests_total{route,type,status}
download_active_streams{route}
download_bytes_total{route,type}
download_duration_seconds{route,type,result}
download_time_to_first_byte_seconds{route,type}
download_client_abort_total{route}
download_stream_failure_total{route,reason}
download_range_requests_total{route,result}
download_quota_rejected_total{route,reason}
```

## 57.1 Labels

Avoid:

- document ID;
- user ID;
- filename;
- raw query.

Use route/type/result.

## 57.2 Rule

Streaming metrics must reveal capacity and failures without high-cardinality labels.

---

# 58. Tracing

## 58.1 Long spans

A download span may last minutes.

Sampling and storage cost matters.

## 58.2 Events

Add span events:

```text
download.authorized
download.first_byte
download.completed
download.client_aborted
```

## 58.3 Source spans

Trace object storage/DB reads.

## 58.4 Rule

Use tracing selectively for long streaming.

---

# 59. Logging

## 59.1 Log start

```text
download.start route documentType size actor tenant correlation
```

## 59.2 Log end

```text
download.end result bytes duration
```

## 59.3 Client abort

Info/debug, not error spam.

## 59.4 Do not log

- raw file content;
- signed URLs;
- tokens;
- full sensitive query;
- unsafe filename unescaped.

## 59.5 Rule

Streaming logs should be lifecycle records.

---

# 60. Testing Streaming Responses

## 60.1 Assert headers

- Content-Type;
- Content-Disposition;
- Content-Length if known;
- Cache-Control;
- ETag;
- Accept-Ranges.

## 60.2 Assert body incrementally

Use client that streams response body, not loads all bytes.

## 60.3 Assert no memory spike

Use large test file with memory monitoring.

## 60.4 Rule

Streaming tests should not accidentally buffer whole response in test client.

---

# 61. Testing Large Files

## 61.1 Generate large file

Use sparse/temp file where possible.

## 61.2 Test

- 100MB+ download;
- concurrent downloads;
- checksum matches;
- Content-Length correct;
- memory bounded.

## 61.3 Timeouts

Test gateway/app timeout.

## 61.4 Rule

Small files do not prove streaming correctness.

---

# 62. Testing Range Requests

## 62.1 Range start-end

```http
Range: bytes=0-99
```

Expect:

```http
206
Content-Range: bytes 0-99/size
Content-Length: 100
```

## 62.2 Suffix

```http
Range: bytes=-100
```

## 62.3 Open ended

```http
Range: bytes=100-
```

## 62.4 Invalid

```http
Range: bytes=999999-
```

Expect 416.

## 62.5 If-Range

Test changed ETag returns full 200.

## 62.6 Rule

Range tests are protocol tests, not just content tests.

---

# 63. Testing Client Disconnect

## 63.1 Simulate cancel

Client starts download then closes socket.

## 63.2 Assert

- source stream closed;
- no thread leak;
- audit marks client_aborted;
- logs not error-spammed;
- metrics increment.

## 63.3 Hard in unit tests

Use integration test or custom client.

## 63.4 Rule

Client disconnect is a first-class streaming scenario.

---

# 64. OpenAPI Documentation

## 64.1 Binary response

```yaml
content:
  application/pdf:
    schema:
      type: string
      format: binary
```

## 64.2 Headers

Document:

- Content-Disposition;
- Content-Length;
- ETag;
- Last-Modified;
- Accept-Ranges;
- Content-Range for 206;
- Cache-Control.

## 64.3 Statuses

- 200 full content;
- 206 partial content;
- 304 not modified;
- 401/403/404;
- 416 unsatisfiable range;
- 429/503 quota/overload.

## 64.4 Rule

Download APIs need header documentation.

---

# 65. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 65.1 StreamingOutput standard

Interface is standard.

## 65.2 Differences

- thread model;
- buffering;
- flush behavior;
- file provider optimization;
- zero-copy/sendfile support;
- client disconnect exception type;
- compression filters;
- response commit timing.

## 65.3 Test on target

Especially for:

- large file;
- range;
- gateway;
- compression;
- async/reactive runtime.

## 65.4 Rule

Streaming behavior is sensitive to runtime/container/proxy.

---

# 66. Gateway/CDN/Reverse Proxy Notes

## 66.1 Buffering

Proxy may buffer entire response.

Bad for streaming.

## 66.2 Timeouts

Long downloads may exceed idle/request timeouts.

## 66.3 Range

CDN/object storage can handle range better than app.

## 66.4 Headers

Ensure proxy preserves:

- Content-Disposition;
- ETag;
- Accept-Ranges;
- Content-Range;
- Cache-Control.

## 66.5 Rule

Test download through full production path.

---

# 67. Common Failure Modes

## 67.1 `readAllBytes()` for large files

Memory blow-up.

## 67.2 No authorization before stream

Data leak.

## 67.3 Wrong Content-Length

Broken clients.

## 67.4 Mid-stream exception expected to become Problem Details

Too late.

## 67.5 Holding DB transaction for slow client

Resource exhaustion.

## 67.6 No Content-Disposition

Bad UX.

## 67.7 Unsafe filename

Header injection/path confusion.

## 67.8 Range advertised but not implemented

Client resume fails.

## 67.9 Multiple range mishandled

Protocol/security bug.

## 67.10 Gateway buffers response

No real streaming.

## 67.11 No client abort cleanup

Resource leak.

## 67.12 Export bypasses field-level authorization

Data breach.

---

# 68. Best Practices

## 68.1 Avoid `byte[]` for large payloads

Use stream/file provider/object storage.

## 68.2 Decide headers before writing

Status, type, length, disposition, cache, validators.

## 68.3 Authorize before streaming

And enforce tenant/data policy.

## 68.4 Set Content-Length when exact

Especially files/ranges.

## 68.5 Use Content-Disposition safely

Support `filename*` for UTF-8.

## 68.6 Support Range only if correct

Single range first.

## 68.7 Prefer export job for long generated files

Generate then download.

## 68.8 Close source resources

Do not leak streams/connections.

## 68.9 Observe bytes/duration/abort

Streaming needs operational visibility.

## 68.10 Test with large files and gateway

Small localhost test is insufficient.

---

# 69. Anti-Patterns

## 69.1 Streaming as excuse for no pagination

Do not stream millions of DB rows from OLTP casually.

## 69.2 Direct DB cursor to slow clients

DB resources held too long.

## 69.3 Raw user filename in header

Security bug.

## 69.4 `application/octet-stream` for everything

Poor UX/security.

## 69.5 No quota for exports

Abuse.

## 69.6 Range parsing by naive substring

Protocol bugs.

## 69.7 Compressing already compressed files

Waste.

## 69.8 Logging full download query with PII

Leak.

## 69.9 Serving tenant files from public static folder

Bypass authorization.

## 69.10 Ignoring IOException

Leads to misleading success audit.

---

# 70. Production Checklist

## 70.1 Contract

- [ ] Download media type defined.
- [ ] Content-Disposition defined.
- [ ] Filename sanitized and encoded.
- [ ] Content-Length policy defined.
- [ ] Cache-Control policy defined.
- [ ] ETag/Last-Modified included where meaningful.
- [ ] Range support policy documented.
- [ ] 200/206/304/416 documented.

## 70.2 Security

- [ ] Authenticate before streaming.
- [ ] Authorize document/export scope.
- [ ] Tenant/data filters enforced.
- [ ] Field-level export policy applied.
- [ ] Rate limit/quota enforced.
- [ ] No raw path exposure.
- [ ] `nosniff` for browser downloads.
- [ ] Audit start/end/failure.

## 70.3 Resource management

- [ ] No full payload in memory for large files.
- [ ] Source streams closed.
- [ ] DB transactions not held unbounded.
- [ ] Concurrent download limit.
- [ ] Client disconnect handled.
- [ ] Temp files cleaned.
- [ ] Gateway buffering tested.

## 70.4 Range

- [ ] `Accept-Ranges` only if supported.
- [ ] Range parser tested.
- [ ] 206 Content-Range correct.
- [ ] 416 Content-Range correct.
- [ ] If-Range behavior defined.
- [ ] Multi-range policy defined.

## 70.5 Observability/testing

- [ ] Large file tests.
- [ ] Concurrent download tests.
- [ ] Range tests.
- [ ] Client abort test.
- [ ] Checksum test.
- [ ] Memory profile.
- [ ] Metrics/logs/traces.

---

# 71. Latihan

## Latihan 1 — Basic StreamingOutput

Buat endpoint:

```http
GET /downloads/hello.txt
```

Return `StreamingOutput` dengan:

- `Content-Type: text/plain; charset=utf-8`;
- `Content-Disposition: attachment`;
- body streaming.

## Latihan 2 — Large File Download

Stream file 500MB tanpa `readAllBytes`.

Assert memory tetap bounded.

## Latihan 3 — Content-Disposition UTF-8

Filename:

```text
laporan bulan júni.csv
```

Generate:

```http
filename="fallback.csv"
filename*=UTF-8''...
```

## Latihan 4 — CSV Export Streaming

Stream 1 juta rows dari generator.

Sanitize CSV injection.

No full list in memory.

## Latihan 5 — Range Request

Support:

```http
Range: bytes=0-99
Range: bytes=100-
Range: bytes=-100
```

Return 206/416 correctly.

## Latihan 6 — If-Range

If ETag matches, return 206.

If ETag stale, return 200 full.

## Latihan 7 — Client Abort

Start download then cancel.

Assert source stream closed and audit status `client_aborted`.

## Latihan 8 — Export Job Refactor

For long CSV generation, implement:

```http
POST /exports → 202
GET /exports/{id}/download
```

## Latihan 9 — Gateway Test

Run behind reverse proxy.

Verify streaming not buffered and headers preserved.

---

# 72. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `StreamingOutput` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/streamingoutput

2. Jakarta RESTful Web Services 4.0 — Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 — `MessageBodyWriter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodywriter

4. RFC 9110 — HTTP Semantics: Range Requests, 206, Content-Range, Accept-Ranges  
   https://www.rfc-editor.org/rfc/rfc9110.html

5. RFC 6266 — Use of the Content-Disposition Header Field in HTTP  
   https://datatracker.ietf.org/doc/html/rfc6266

6. MDN — HTTP Range requests  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests

7. RFC 9111 — HTTP Caching  
   https://www.rfc-editor.org/rfc/rfc9111.html

---

# 73. Penutup

Streaming response adalah alat penting untuk large download dan generated content, tetapi harus dirancang sebagai protokol dan lifecycle, bukan hanya callback.

Mental model final:

```text
Before bytes:
  decide status, headers, auth, metadata, range, cache, validators

During bytes:
  copy from source to OutputStream with bounded memory

After bytes:
  close source, audit result, record metrics

On failure:
  if before commit → Problem Details possible
  if after commit  → connection failure / partial content, not normal error body
```

Prinsip final:

```text
Streaming saves memory.
It does not automatically save threads.
It does not make mid-stream errors clean.
It does not replace authorization, quota, or export job design.
```

Top-tier JAX-RS engineer memastikan:

- tidak memakai `byte[]` untuk file besar;
- header download benar;
- filename aman dan encoded;
- range support benar atau tidak diiklankan;
- export tidak memegang DB transaction terlalu lama;
- authorization/tenant/field policy diterapkan sebelum streaming;
- client abort bukan error spam;
- gateway/proxy tidak buffering;
- memory/thread/bandwidth terukur;
- generated file critical dibuat sebagai job/temp artifact.

Part berikutnya:

```text
Bagian 027 — Multipart and File Upload
```

Kita akan membahas upload secara mendalam: multipart/form-data, `EntityPart`, streaming upload, size limits, virus scanning, content-type validation, object storage, transactional metadata, and secure file handling.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-025.md](./learn-jaxrs-advanced-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-027.md](./learn-jaxrs-advanced-part-027.md)
