# learn-jaxrs-advanced-part-016.md

# Bagian 016 — Interceptors: `ReaderInterceptor`, `WriterInterceptor`, Entity Stream Pipeline, Compression, Encryption, Signature, Body Hash, Priority, Name Binding, dan Production-Safe Stream Transformation

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **JAX-RS/Jakarta REST interceptors** secara production-grade. Fokus part ini bukan hanya contoh GZIP interceptor, tetapi memahami interceptor sebagai wrapper di sekitar entity body processing: request body sebelum `MessageBodyReader`, response body sebelum/selama `MessageBodyWriter`, stream wrapping, `proceed()`, priority chain, name binding, compression/encryption/signature/checksum, body hash, logging pitfalls, error handling, async/streaming caveats, observability, dan testing.
>
> Namespace utama: `jakarta.ws.rs.ext.ReaderInterceptor`, `jakarta.ws.rs.ext.WriterInterceptor`, `jakarta.ws.rs.ext.ReaderInterceptorContext`, `jakarta.ws.rs.ext.WriterInterceptorContext`, `jakarta.ws.rs.NameBinding`, `jakarta.annotation.Priority`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Interceptor Membungkus Entity Stream](#2-mental-model-interceptor-membungkus-entity-stream)
3. [Filter vs Interceptor vs MessageBodyReader/Writer](#3-filter-vs-interceptor-vs-messagebodyreaderwriter)
4. [Di Mana Interceptor Berada dalam Pipeline](#4-di-mana-interceptor-berada-dalam-pipeline)
5. [`ReaderInterceptor`: Membungkus Request Body Reading](#5-readerinterceptor-membungkus-request-body-reading)
6. [`WriterInterceptor`: Membungkus Response Body Writing](#6-writerinterceptor-membungkus-response-body-writing)
7. [`proceed()`: Kontrak yang Tidak Boleh Dilupakan](#7-proceed-kontrak-yang-tidak-boleh-dilupakan)
8. [`ReaderInterceptorContext`: Input Stream, Headers, Type, Media](#8-readerinterceptorcontext-input-stream-headers-type-media)
9. [`WriterInterceptorContext`: Entity, Output Stream, Headers, Type, Media](#9-writerinterceptorcontext-entity-output-stream-headers-type-media)
10. [Interceptor Chain dan Wrapping Semantics](#10-interceptor-chain-dan-wrapping-semantics)
11. [Priority Ordering dengan `@Priority`](#11-priority-ordering-dengan-priority)
12. [Global, Name-Bound, dan Dynamic Binding](#12-global-name-bound-dan-dynamic-binding)
13. [Name Binding untuk Interceptor](#13-name-binding-untuk-interceptor)
14. [DynamicFeature untuk Conditional Interceptor](#14-dynamicfeature-untuk-conditional-interceptor)
15. [Provider Lifecycle dan Thread Safety](#15-provider-lifecycle-dan-thread-safety)
16. [Use Case: GZIP Reader/Writer Interceptor](#16-use-case-gzip-readerwriter-interceptor)
17. [GZIP Request Body: `Content-Encoding: gzip`](#17-gzip-request-body-content-encoding-gzip)
18. [GZIP Response Body: `Accept-Encoding` dan `Content-Encoding`](#18-gzip-response-body-accept-encoding-dan-content-encoding)
19. [Use Case: Request Body Hashing](#19-use-case-request-body-hashing)
20. [Use Case: Response Body Hashing / Digest](#20-use-case-response-body-hashing--digest)
21. [Use Case: Signature Verification](#21-use-case-signature-verification)
22. [Use Case: Response Signing](#22-use-case-response-signing)
23. [Use Case: Encryption/Decryption Envelope](#23-use-case-encryptiondecryption-envelope)
24. [Use Case: Transparent Decompression](#24-use-case-transparent-decompression)
25. [Use Case: Metrics untuk Entity Bytes](#25-use-case-metrics-untuk-entity-bytes)
26. [Use Case: Limited Input Stream untuk Payload Size Guard](#26-use-case-limited-input-stream-untuk-payload-size-guard)
27. [Use Case: Audit Hash Tanpa Logging Body](#27-use-case-audit-hash-tanpa-logging-body)
28. [Kenapa Body Logging di Interceptor Tetap Berbahaya](#28-kenapa-body-logging-di-interceptor-tetap-berbahaya)
29. [ReaderInterceptor dan JSON Parsing](#29-readerinterceptor-dan-json-parsing)
30. [WriterInterceptor dan JSON Serialization](#30-writerinterceptor-dan-json-serialization)
31. [Interceptor dan `MessageBodyReader/Writer` Selection](#31-interceptor-dan-messagebodyreaderwriter-selection)
32. [Interceptor dan `Providers` Manual Invocation](#32-interceptor-dan-providers-manual-invocation)
33. [Headers Mutation di Interceptor](#33-headers-mutation-di-interceptor)
34. [InputStream/OutputStream Wrapping Pattern](#34-inputstreamoutputstream-wrapping-pattern)
35. [Restoring Old Stream: Kapan Perlu, Kapan Tidak](#35-restoring-old-stream-kapan-perlu-kapan-tidak)
36. [Closing, Flushing, dan Finishing Streams](#36-closing-flushing-dan-finishing-streams)
37. [Error Handling di Interceptor](#37-error-handling-di-interceptor)
38. [Response Already Committed dan Writer Error](#38-response-already-committed-dan-writer-error)
39. [Interceptor dan `StreamingOutput`](#39-interceptor-dan-streamingoutput)
40. [Interceptor dan Multipart](#40-interceptor-dan-multipart)
41. [Interceptor dan Conditional Requests / ETag](#41-interceptor-dan-conditional-requests--etag)
42. [Interceptor dan Caching](#42-interceptor-dan-caching)
43. [Interceptor dan Security](#43-interceptor-dan-security)
44. [Interceptor dan Async/Non-Blocking Runtime](#44-interceptor-dan-asyncnon-blocking-runtime)
45. [Interceptor dan Gateway/Server Compression](#45-interceptor-dan-gatewayserver-compression)
46. [Testing Interceptors](#46-testing-interceptors)
47. [Observability](#47-observability)
48. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#48-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
49. [Migration: `javax.ws.rs.ext` ke `jakarta.ws.rs.ext`](#49-migration-javaxxwrsext-ke-jakartawrs-ext)
50. [Common Failure Modes](#50-common-failure-modes)
51. [Best Practices](#51-best-practices)
52. [Anti-Patterns](#52-anti-patterns)
53. [Production Checklist](#53-production-checklist)
54. [Latihan](#54-latihan)
55. [Referensi Resmi](#55-referensi-resmi)
56. [Penutup](#56-penutup)

---

# 1. Tujuan Part Ini

Pada part sebelumnya, kita membahas **filters**.

Filter cocok untuk:

```text
request/response metadata
headers
security context
abortWith
correlation ID
CORS
rate limit
```

Namun ada concern yang menyentuh **entity bytes**:

- request body dikompresi;
- response body perlu dikompresi;
- request body perlu diverifikasi signature-nya;
- response body perlu ditandatangani;
- request body perlu dihitung hash saat dibaca;
- response body perlu dihitung bytes/digest saat ditulis;
- body stream perlu dibungkus untuk encryption/decryption;
- payload size perlu dibatasi pada stream level.

Untuk hal-hal seperti ini, filter kurang tepat karena filter bekerja di sekitar request/response metadata, bukan secara khusus di sekitar `MessageBodyReader`/`MessageBodyWriter`.

JAX-RS menyediakan **entity interceptors**:

```java
ReaderInterceptor
WriterInterceptor
```

## 1.1 Pertanyaan utama

Part ini menjawab:

- kapan memakai interceptor, bukan filter?
- bagaimana `ReaderInterceptor` membungkus `MessageBodyReader.readFrom`?
- bagaimana `WriterInterceptor` membungkus `MessageBodyWriter.writeTo`?
- apa arti `context.proceed()`?
- bagaimana wrapping stream yang aman?
- bagaimana compression/signature/hash dilakukan tanpa merusak pipeline?
- bagaimana priority dan name binding bekerja?
- bagaimana menghindari memory blow-up dan body logging leak?
- bagaimana menguji interceptor via runtime?

## 1.2 Prinsip utama

```text
Interceptor is for entity stream transformation/observation around message body readers/writers.
Filter is for request/response metadata and control flow.
```

---

# 2. Mental Model: Interceptor Membungkus Entity Stream

Entity interceptor berada di sekitar proses mapping:

```text
Request bytes → Java object
Java object → Response bytes
```

## 2.1 Reader side

```text
HTTP request body InputStream
  ↓
ReaderInterceptor chain
  ↓
MessageBodyReader.readFrom(...)
  ↓
Java entity parameter
```

## 2.2 Writer side

```text
Java response entity
  ↓
MessageBodyWriter.writeTo(...)
  wrapped by WriterInterceptor chain
  ↓
HTTP response body OutputStream
```

## 2.3 Analogi

Filter seperti petugas gerbang:

```text
cek ID, tambah nomor antrian, tolak request, tambah header
```

Interceptor seperti pipa pemrosesan barang:

```text
decompress box before reading
compress package before sending
calculate weight while passing through pipe
encrypt/decrypt payload stream
```

## 2.4 Top-tier rule

```text
If you need to wrap InputStream or OutputStream, think interceptor.
If you only need headers/status/security context, think filter.
```

---

# 3. Filter vs Interceptor vs MessageBodyReader/Writer

## 3.1 Filter

Works with request/response context.

Good for:

- auth;
- CORS;
- correlation ID;
- rate limit;
- response headers;
- aborting request;
- request metadata logging.

## 3.2 Interceptor

Wraps entity read/write calls.

Good for:

- compression;
- encryption/decryption;
- digital signature;
- checksum/digest;
- body byte metrics;
- stream-level limit;
- transparent decode/encode.

## 3.3 MessageBodyReader

Actually parses request stream into Java object.

Example:

```text
JSON bytes → CreateCustomerRequest
CSV bytes → ImportRequest
```

## 3.4 MessageBodyWriter

Actually serializes Java object into response stream.

Example:

```text
CustomerResponse → JSON bytes
ExportRows → CSV bytes
```

## 3.5 Decision

```text
Need to parse custom format? → MessageBodyReader
Need to serialize custom format? → MessageBodyWriter
Need to wrap stream around parser/writer? → Interceptor
Need to add/check metadata before/after? → Filter
```

## 3.6 Rule

Do not implement a JSON parser inside interceptor. Let `MessageBodyReader` do parsing.

---

# 4. Di Mana Interceptor Berada dalam Pipeline

Simplified server pipeline:

```text
HTTP request
  ↓
filters
  ↓
resource matching
  ↓
ReaderInterceptor chain
  ↓
MessageBodyReader
  ↓
resource method
  ↓
response filters
  ↓
WriterInterceptor chain
  ↓
MessageBodyWriter
  ↓
HTTP response
```

## 4.1 Request body may be read lazily

Entity reading happens when runtime needs entity parameter.

## 4.2 Response body may be written late

Response filters run before writer/interceptor writes bytes.

## 4.3 Exception mapper response

If exception mapper returns entity, writer interceptors may apply to error response too depending binding/global scope and whether resource matched.

## 4.4 Direct provider calls

If application code manually calls `MessageBodyReader.readFrom` or `MessageBodyWriter.writeTo` via `Providers`, interceptors are not part of that normal pipeline.

## 4.5 Rule

Interceptors belong to JAX-RS normal entity read/write pipeline.

---

# 5. `ReaderInterceptor`: Membungkus Request Body Reading

Interface:

```java
public interface ReaderInterceptor {
    Object aroundReadFrom(ReaderInterceptorContext context)
        throws IOException, WebApplicationException;
}
```

## 5.1 What it wraps

It wraps:

```java
MessageBodyReader.readFrom(...)
```

## 5.2 Basic skeleton

```java
@Provider
public class MyReaderInterceptor implements ReaderInterceptor {

    @Override
    public Object aroundReadFrom(ReaderInterceptorContext context)
        throws IOException, WebApplicationException {

        // before body reader
        Object result = context.proceed();
        // after body reader

        return result;
    }
}
```

## 5.3 Return object

Reader interceptor returns the Java object result from downstream chain/reader.

## 5.4 If it does not call `proceed`

The actual body reader may never run.

This can be intentional only in rare replacement scenarios.

## 5.5 Use cases

- decompress request body;
- verify body signature while reading;
- limit body size;
- calculate hash;
- record byte count;
- decrypt envelope stream.

## 5.6 Rule

ReaderInterceptor manipulates input stream before the request entity becomes Java object.

---

# 6. `WriterInterceptor`: Membungkus Response Body Writing

Interface:

```java
public interface WriterInterceptor {
    void aroundWriteTo(WriterInterceptorContext context)
        throws IOException, WebApplicationException;
}
```

## 6.1 What it wraps

It wraps:

```java
MessageBodyWriter.writeTo(...)
```

## 6.2 Basic skeleton

```java
@Provider
public class MyWriterInterceptor implements WriterInterceptor {

    @Override
    public void aroundWriteTo(WriterInterceptorContext context)
        throws IOException, WebApplicationException {

        // before writer
        context.proceed();
        // after writer
    }
}
```

## 6.3 Void method

Writer interceptor does not return entity; it writes to output stream.

## 6.4 Use cases

- compress response;
- calculate response body bytes;
- compute digest/signature;
- encrypt response stream;
- wrap output stream for monitoring.

## 6.5 Risk

If response bytes are already being written, errors may occur after headers/status committed.

## 6.6 Rule

WriterInterceptor manipulates output stream while response entity becomes bytes.

---

# 7. `proceed()`: Kontrak yang Tidak Boleh Dilupakan

`context.proceed()` continues the interceptor chain.

## 7.1 Reader

```java
Object result = context.proceed();
```

Eventually invokes `MessageBodyReader.readFrom`.

## 7.2 Writer

```java
context.proceed();
```

Eventually invokes `MessageBodyWriter.writeTo`.

## 7.3 If omitted

Downstream interceptors and reader/writer do not execute.

## 7.4 Example accidental bug

```java
@Override
public Object aroundReadFrom(ReaderInterceptorContext context) {
    log.info("reading");
    return null; // body reader never runs
}
```

Resource receives null or fails.

## 7.5 Rare intentional use

You may completely replace entity reading/writing, but that is advanced and risky.

## 7.6 Rule

Almost every interceptor must call `proceed()` exactly once.

---

# 8. `ReaderInterceptorContext`: Input Stream, Headers, Type, Media

`ReaderInterceptorContext` gives access to parameters of `MessageBodyReader.readFrom`.

## 8.1 Important methods

```java
InputStream getInputStream()
void setInputStream(InputStream is)
MultivaluedMap<String, String> getHeaders()
Object proceed()
Class<?> getType()
Type getGenericType()
Annotation[] getAnnotations()
MediaType getMediaType()
Object getProperty(String name)
void setProperty(String name, Object value)
```

## 8.2 Input stream

```java
InputStream old = context.getInputStream();
context.setInputStream(new GZIPInputStream(old));
Object entity = context.proceed();
```

## 8.3 Runtime closes stream

JAX-RS runtime is responsible for closing input stream.

## 8.4 Mutable headers

Headers are mutable, but reader interceptor should usually roll back header modifications after `proceed()` to avoid externally visible side effects.

## 8.5 Type and media

Useful for conditional behavior:

```java
if (context.getMediaType().isCompatible(MediaType.APPLICATION_JSON_TYPE)) { ... }
```

## 8.6 Rule

ReaderInterceptorContext is your handle to the entity input pipeline.

---

# 9. `WriterInterceptorContext`: Entity, Output Stream, Headers, Type, Media

`WriterInterceptorContext` gives access to parameters of `MessageBodyWriter.writeTo`.

## 9.1 Important methods

```java
Object getEntity()
void setEntity(Object entity)
OutputStream getOutputStream()
void setOutputStream(OutputStream os)
MultivaluedMap<String, Object> getHeaders()
void proceed()
Class<?> getType()
Type getGenericType()
Annotation[] getAnnotations()
MediaType getMediaType()
Object getProperty(String name)
void setProperty(String name, Object value)
```

## 9.2 Output stream

```java
OutputStream old = context.getOutputStream();
GZIPOutputStream gzip = new GZIPOutputStream(old);
context.setOutputStream(gzip);
context.proceed();
gzip.finish();
```

## 9.3 Runtime closes output stream

JAX-RS runtime is responsible for closing output stream that is set.

But wrappers often require `finish()`/`flush()`.

## 9.4 Headers

You can update headers:

```java
context.getHeaders().putSingle("Content-Encoding", "gzip");
```

## 9.5 Entity

You can replace entity:

```java
context.setEntity(wrappedEntity);
```

Use sparingly because writer selection/type may be affected.

## 9.6 Rule

WriterInterceptorContext is your handle to the entity output pipeline.

---

# 10. Interceptor Chain dan Wrapping Semantics

Multiple interceptors form a chain.

## 10.1 Reader chain

```text
Interceptor A aroundReadFrom
  ↓ proceed
Interceptor B aroundReadFrom
  ↓ proceed
MessageBodyReader.readFrom
  ↑ return
B after proceed
  ↑ return
A after proceed
```

## 10.2 Writer chain

```text
Interceptor A aroundWriteTo
  ↓ proceed
Interceptor B aroundWriteTo
  ↓ proceed
MessageBodyWriter.writeTo
  ↑ return
B after proceed
  ↑ return
A after proceed
```

## 10.3 Wrapping stream order

If A wraps stream then B wraps stream, bytes pass through wrappers in a specific order.

This matters for compression/encryption/signature.

## 10.4 Example order

```text
sign then compress
compress then sign
encrypt then compress
compress then encrypt
```

These are not equivalent.

## 10.5 Rule

For byte transformations, interceptor order is part of protocol/security contract.

---

# 11. Priority Ordering dengan `@Priority`

Interceptors are sorted by priority.

## 11.1 Example

```java
@Provider
@Priority(Priorities.ENTITY_CODER)
public class GzipInterceptor implements ReaderInterceptor, WriterInterceptor {
    ...
}
```

## 11.2 Lower number higher priority for ReadFrom/WriteTo chains

JAX-RS spec says chains for `ReadFrom` and `WriteTo` extension points are sorted ascending: lower number means higher priority.

## 11.3 Same priority

Order is implementation-dependent.

## 11.4 Use named constants

```java
Priorities.AUTHENTICATION
Priorities.AUTHORIZATION
Priorities.ENTITY_CODER
Priorities.HEADER_DECORATOR
Priorities.USER
```

## 11.5 Custom priority

Use only when relative order matters.

## 11.6 Rule

If compression must happen before encryption, specify priorities and test order.

---

# 12. Global, Name-Bound, dan Dynamic Binding

## 12.1 Global interceptor

No name binding.

```java
@Provider
public class GlobalMetricsInterceptor implements WriterInterceptor { ... }
```

Applies globally.

## 12.2 Name-bound interceptor

Applies only to annotated resource methods/classes.

```java
@Compressed
@Provider
public class CompressionInterceptor implements WriterInterceptor { ... }
```

## 12.3 Dynamic binding

`DynamicFeature` registers interceptor based on `ResourceInfo`.

## 12.4 Application binding

Name-binding annotation can also be placed on `Application` subclass to bind globally.

## 12.5 Rule

Use global only for safe universal behavior; use name-binding for endpoint-specific stream behavior.

---

# 13. Name Binding untuk Interceptor

## 13.1 Define binding

```java
@NameBinding
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Compressed {
}
```

## 13.2 Interceptor

```java
@Compressed
@Provider
@Priority(Priorities.ENTITY_CODER)
public class GzipWriterInterceptor implements WriterInterceptor {
    ...
}
```

## 13.3 Resource

```java
@GET
@Path("/reports/{id}/file")
@Produces("application/json")
@Compressed
public ReportResponse report(...) { ... }
```

## 13.4 Multiple name bindings

If interceptor class has multiple binding annotations, all must be present on resource/method for binding.

## 13.5 Rule

Name binding makes stream transformations explicit in resource contract.

---

# 14. DynamicFeature untuk Conditional Interceptor

Sometimes binding needs annotation values.

## 14.1 Annotation

```java
@Target({TYPE, METHOD})
@Retention(RUNTIME)
public @interface BodySignatureRequired {
    String algorithm() default "HmacSHA256";
}
```

## 14.2 Feature

```java
@Provider
public class BodySignatureFeature implements DynamicFeature {

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        BodySignatureRequired ann =
            resourceInfo.getResourceMethod().getAnnotation(BodySignatureRequired.class);

        if (ann != null) {
            context.register(new SignatureVerificationInterceptor(ann.algorithm()));
        }
    }
}
```

## 14.3 Why not name binding?

Name binding cannot easily pass annotation value into interceptor instance.

## 14.4 Caution

Dynamically constructed interceptors need thread-safe immutable state.

## 14.5 Rule

Use DynamicFeature for annotation-value-driven interceptor binding.

---

# 15. Provider Lifecycle dan Thread Safety

JAX-RS providers are typically singletons per application by default.

## 15.1 Interceptor instance reused

Same interceptor instance may handle multiple concurrent requests.

## 15.2 Avoid mutable request state

Bad:

```java
private String currentCorrelationId;
```

## 15.3 Use local variables/context properties

```java
String correlationId = (String) context.getProperty("correlationId");
```

## 15.4 Thread-safe helpers

Use immutable/thread-safe:

- `MessageDigest` is not thread-safe if shared;
- `Mac` is not thread-safe if shared;
- `DateTimeFormatter` is thread-safe;
- `SimpleDateFormat` is not.

## 15.5 Dependency injection

Injected services must be thread-safe or scoped correctly.

## 15.6 Rule

Assume interceptor is called concurrently.

---

# 16. Use Case: GZIP Reader/Writer Interceptor

GZIP is canonical interceptor use case.

## 16.1 Combined interceptor

```java
@Provider
@Priority(Priorities.ENTITY_CODER)
public class GzipInterceptor implements ReaderInterceptor, WriterInterceptor {

    @Override
    public Object aroundReadFrom(ReaderInterceptorContext context)
        throws IOException, WebApplicationException {

        String encoding = firstHeader(context.getHeaders(), "Content-Encoding");
        if (!"gzip".equalsIgnoreCase(encoding)) {
            return context.proceed();
        }

        InputStream old = context.getInputStream();
        context.setInputStream(new GZIPInputStream(old));
        try {
            return context.proceed();
        } finally {
            context.setInputStream(old);
        }
    }

    @Override
    public void aroundWriteTo(WriterInterceptorContext context)
        throws IOException, WebApplicationException {

        OutputStream old = context.getOutputStream();
        GZIPOutputStream gzip = new GZIPOutputStream(old);
        context.setOutputStream(gzip);
        context.getHeaders().putSingle("Content-Encoding", "gzip");
        context.getHeaders().add("Vary", "Accept-Encoding");

        try {
            context.proceed();
        } finally {
            gzip.finish();
            context.setOutputStream(old);
        }
    }

    private String firstHeader(MultivaluedMap<String, String> headers, String name) {
        return headers.getFirst(name);
    }
}
```

## 16.2 Missing conditions

This simple example compresses every response if bound.

Production should check:

- client `Accept-Encoding`;
- response media type;
- size threshold;
- already compressed formats;
- status codes;
- no entity response;
- existing `Content-Encoding`.

## 16.3 Content-Length

When compressing, original `Content-Length` is invalid.

Remove or avoid setting it unless compressed length known.

## 16.4 Gateway

Often compression is better handled by server/gateway.

## 16.5 Rule

GZIP interceptor is educational; production compression is usually infrastructure-level unless app-specific.

---

# 17. GZIP Request Body: `Content-Encoding: gzip`

Request body compression is indicated with:

```http
Content-Encoding: gzip
```

not `Content-Type`.

## 17.1 Content-Type remains representation type

```http
Content-Type: application/json
Content-Encoding: gzip
```

means:

```text
entity is JSON representation encoded with gzip
```

## 17.2 ReaderInterceptor role

Decompress stream before `MessageBodyReader` reads JSON.

## 17.3 Reject unsupported encoding

If server does not support encoding:

```text
415 Unsupported Media Type
```

or `400` depending policy, but HTTP semantics usually treats unsupported content coding as unsupported media.

## 17.4 Zip bomb risk

Compressed input can expand massively.

Need decompressed size limit.

## 17.5 Rule

Content-Encoding transforms representation bytes before reader sees them.

---

# 18. GZIP Response Body: `Accept-Encoding` dan `Content-Encoding`

Client declares:

```http
Accept-Encoding: gzip
```

Server responds:

```http
Content-Encoding: gzip
Vary: Accept-Encoding
```

## 18.1 WriterInterceptor role

Compress output stream after `MessageBodyWriter` writes representation bytes.

## 18.2 Conditions

Compress only if:

- client accepts gzip;
- response has entity;
- media type compressible;
- response not already encoded;
- size threshold met if known;
- not streaming format already compressed.

## 18.3 Media types usually not worth compressing

- image/png;
- image/jpeg;
- application/zip;
- video;
- already compressed PDFs sometimes.

## 18.4 Content-Length

Remove or avoid if compressed length unknown.

## 18.5 Rule

Response compression must respect `Accept-Encoding` and `Vary`.

---

# 19. Use Case: Request Body Hashing

Hashing request body while it is read is useful for:

- idempotency;
- audit fingerprint;
- webhook verification;
- content-addressed storage;
- debugging without logging body.

## 19.1 DigestInputStream

```java
@Provider
@BodyHash
public class RequestBodyHashInterceptor implements ReaderInterceptor {

    @Override
    public Object aroundReadFrom(ReaderInterceptorContext context)
        throws IOException, WebApplicationException {

        MessageDigest digest = newDigest();
        DigestInputStream digestStream =
            new DigestInputStream(context.getInputStream(), digest);

        InputStream old = context.getInputStream();
        context.setInputStream(digestStream);

        try {
            Object result = context.proceed();
            byte[] hash = digest.digest();
            context.setProperty("requestBodySha256", HexFormat.of().formatHex(hash));
            return result;
        } finally {
            context.setInputStream(old);
        }
    }

    private MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

## 19.2 Limitation

Hash is computed only for bytes actually read.

If body is not read, no digest.

## 19.3 Ordering

If compressed body is decompressed before hash, hash is of decompressed bytes.

If hash before decompression, hash is of wire bytes.

Choose intentionally.

## 19.4 Rule

Define whether hash is over wire bytes or representation bytes.

---

# 20. Use Case: Response Body Hashing / Digest

You can wrap `OutputStream` to compute digest while response is written.

## 20.1 Challenge

Digest header must be set before response is committed, but digest known only after body written.

## 20.2 Trailer?

HTTP trailers may solve this in some contexts, but support is not universal.

## 20.3 Buffering

Buffer full response, compute digest, then set header and write.

Dangerous for large responses.

## 20.4 Streaming hash

Can log digest after write, but cannot always add header.

## 20.5 Safer

For file/static content, precompute digest before response.

## 20.6 Rule

Response digest header is easy only when body is buffered or digest precomputed.

---

# 21. Use Case: Signature Verification

Webhook APIs often require signature verification.

## 21.1 Header

```http
X-Signature: ...
X-Timestamp: ...
```

## 21.2 Important question

Signature over what?

- raw wire body bytes?
- decompressed representation bytes?
- canonical JSON?
- method + path + timestamp + body?

## 21.3 If signature over raw body

ReaderInterceptor after decompression is too late if decompression already happened.

Need correct ordering or pre-reader raw stream wrapper.

## 21.4 If signature requires full body

You may need buffering or streaming MAC.

## 21.5 Streaming MAC

Wrap input stream with `MacInputStream` that updates MAC as bytes read.

After `proceed()`, compare signature.

## 21.6 Timing

If comparison happens after resource receives entity, resource method hasn't run yet because `proceed()` returns before method invocation.

Good.

## 21.7 Rule

Signature verification must be precisely ordered relative to decoding and parsing.

---

# 22. Use Case: Response Signing

Some APIs sign response body.

## 22.1 Challenge

Signature known after body written.

## 22.2 Options

1. Buffer body, sign, then write with signature header.
2. Use detached signature over precomputed representation.
3. Use HTTP trailers if infrastructure supports.
4. Sign resource version/metadata, not body.
5. Use envelope format signed by `MessageBodyWriter`.

## 22.3 Interceptor option

WriterInterceptor can buffer response body:

```java
ByteArrayOutputStream buffer = new ByteArrayOutputStream();
context.setOutputStream(buffer);
context.proceed();
byte[] bytes = buffer.toByteArray();
String sig = sign(bytes);
headers.putSingle("X-Signature", sig);
old.write(bytes);
```

## 22.4 Danger

Memory blow-up for large response.

## 22.5 Rule

Response signing with headers often requires buffering; avoid for unbounded responses.

---

# 23. Use Case: Encryption/Decryption Envelope

## 23.1 Request decrypt

ReaderInterceptor wraps input stream with decrypting stream.

```java
context.setInputStream(cipherInputStream);
return context.proceed();
```

## 23.2 Response encrypt

WriterInterceptor wraps output stream with encrypting stream.

```java
context.setOutputStream(cipherOutputStream);
context.proceed();
cipherOutputStream.doFinal/close/finish
```

## 23.3 Key management

Do not put key logic in interceptor directly.

Use dedicated crypto service.

## 23.4 Authenticated encryption

Use AEAD modes where applicable.

## 23.5 Metadata

Headers may include key ID, algorithm, nonce.

Do not leak secrets.

## 23.6 Rule

Crypto interceptors are security-critical; design/review/test rigorously.

---

# 24. Use Case: Transparent Decompression

## 24.1 Request

If client sends compressed JSON:

```http
Content-Type: application/json
Content-Encoding: gzip
```

ReaderInterceptor decompresses to JSON stream.

`MessageBodyReader` still sees JSON media type.

## 24.2 Response

If server sends compressed JSON:

```http
Content-Type: application/json
Content-Encoding: gzip
```

Client decompresses to JSON.

## 24.3 Header cleanup

For request, after decompression, some interceptors remove/adjust `Content-Encoding` internally.

But reader interceptor header changes should usually roll back to avoid external side effects.

## 24.4 Size limit after decompression

Always limit decompressed size.

## 24.5 Rule

Compression is representation coding, not media type.

---

# 25. Use Case: Metrics untuk Entity Bytes

## 25.1 Request bytes

Wrap input stream to count bytes read.

## 25.2 Response bytes

Wrap output stream to count bytes written.

## 25.3 Example counting output stream

```java
public final class CountingOutputStream extends FilterOutputStream {
    private long count;

    public CountingOutputStream(OutputStream out) {
        super(out);
    }

    @Override
    public void write(int b) throws IOException {
        out.write(b);
        count++;
    }

    @Override
    public void write(byte[] b, int off, int len) throws IOException {
        out.write(b, off, len);
        count += len;
    }

    public long count() {
        return count;
    }
}
```

## 25.4 Writer interceptor

```java
CountingOutputStream counting = new CountingOutputStream(context.getOutputStream());
context.setOutputStream(counting);
try {
    context.proceed();
} finally {
    metrics.recordResponseBytes(counting.count());
}
```

## 25.5 Beware compression

Count before or after compression?

Depends where interceptor sits.

## 25.6 Rule

Define metric meaning: wire bytes vs representation bytes.

---

# 26. Use Case: Limited Input Stream untuk Payload Size Guard

## 26.1 Why interceptor?

A reader interceptor can enforce max bytes actually read.

## 26.2 Example concept

```java
InputStream limited = new BoundedInputStream(context.getInputStream(), maxBytes);
context.setInputStream(limited);
return context.proceed();
```

If limit exceeded:

```java
throw new WebApplicationException(
    Response.status(413)
        .type("application/problem+json")
        .entity(problem("CONTENT_TOO_LARGE"))
        .build()
);
```

## 26.3 Layers

Still enforce size at gateway/server too.

## 26.4 Decompressed size

If request compressed, enforce decompressed limit after decompression.

## 26.5 Rule

Payload size protection should exist at multiple layers.

---

# 27. Use Case: Audit Hash Tanpa Logging Body

Audit systems may need prove body integrity without storing content.

## 27.1 Hash

Compute SHA-256 while stream passes.

## 27.2 Store

Store:

- hash;
- algorithm;
- content type;
- content length;
- timestamp;
- actor;
- correlation ID.

## 27.3 Do not store body

Unless required and allowed.

## 27.4 Canonicalization

For JSON, raw byte hash changes if whitespace/order changes.

If semantic hash needed, canonicalize JSON carefully.

## 27.5 Rule

Hash is safer than body log, but still part of privacy/security design.

---

# 28. Kenapa Body Logging di Interceptor Tetap Berbahaya

Some engineers think interceptor is a safe place to log body.

It is not automatically safe.

## 28.1 Risks

- PII/secret leakage;
- memory blow-up;
- breaks streaming;
- compliance violations;
- log injection;
- huge logs;
- raw binary output.

## 28.2 Body preview

Even preview can leak sensitive data.

## 28.3 Safer alternatives

- content length;
- content type;
- digest;
- schema validation summary;
- error category;
- route template;
- correlation ID.

## 28.4 Lower environments

If body logging allowed, use:

- explicit allowlist;
- max bytes;
- redaction;
- disabled by default;
- never file uploads/auth endpoints.

## 28.5 Rule

Interceptor sees bytes; that power is dangerous.

---

# 29. ReaderInterceptor dan JSON Parsing

## 29.1 Do not parse JSON here

Bad:

```java
JsonObject json = Json.createReader(context.getInputStream()).readObject();
```

Then `MessageBodyReader` cannot read stream unless you replace it.

## 29.2 If you inspect body

Need buffering/replay or stream parser wrapper.

## 29.3 Better

Use MessageBodyReader for format parsing.

Use ReaderInterceptor for stream transformation/observation.

## 29.4 Signature verification

If JSON canonicalization needed for signature, maybe custom reader or explicit resource design is better.

## 29.5 Rule

ReaderInterceptor should not become a second JSON parser unless intentionally implementing infrastructure.

---

# 30. WriterInterceptor dan JSON Serialization

## 30.1 Before serialization

WriterInterceptor sees Java entity and output stream.

## 30.2 It can replace entity

```java
context.setEntity(envelope);
```

But this can alter writer selection/type.

## 30.3 Envelope response

If every response needs envelope, prefer response DTO or dedicated writer/provider.

## 30.4 Hash after serialization

Wrap output stream.

## 30.5 JSON pretty print

Do not implement pretty print in interceptor. Configure provider.

## 30.6 Rule

WriterInterceptor should not replace JSON provider configuration.

---

# 31. Interceptor dan `MessageBodyReader/Writer` Selection

Provider selection happens based on target type/media.

Interceptor wraps selected reader/writer call.

## 31.1 It does not choose reader/writer

Interceptor should not reimplement provider selection.

## 31.2 It can modify context type/media

`InterceptorContext` allows setting type/generic type/media/annotations.

This is advanced and dangerous.

## 31.3 Example danger

Changing media type in interceptor can cause mismatch with headers/selected provider.

## 31.4 Rule

Do not change type/media unless you fully understand provider selection consequences.

---

# 32. Interceptor dan `Providers` Manual Invocation

Spec notes direct calls to `MessageBodyReader.readFrom` or `MessageBodyWriter.writeTo` from application code via `Providers` do not trigger entity interceptors because they are outside normal JAX-RS processing pipeline.

## 32.1 Example

```java
MessageBodyWriter<MyDto> writer = providers.getMessageBodyWriter(...);
writer.writeTo(...); // interceptors not automatically applied
```

## 32.2 Implication

Do not manually call providers expecting compression/signature/hash interceptors to run.

## 32.3 Better

Let JAX-RS runtime write response normally.

## 32.4 Rule

Interceptors are pipeline features, not general-purpose provider wrappers.

---

# 33. Headers Mutation di Interceptor

Both contexts expose mutable headers.

## 33.1 Reader headers

```java
context.getHeaders()
```

Mutable map of request headers.

But modifications should typically be rolled back after `proceed()`.

## 33.2 Writer headers

```java
context.getHeaders()
```

Mutable response headers.

Can set `Content-Encoding`, remove `Content-Length`, add `Vary`.

## 33.3 Header consistency

If you compress response:

```java
headers.putSingle("Content-Encoding", "gzip");
headers.remove("Content-Length");
headers.add("Vary", "Accept-Encoding");
```

## 33.4 Do not lie

If output not actually compressed, don't set header.

## 33.5 Rule

Header mutation must match actual bytes on the wire.

---

# 34. InputStream/OutputStream Wrapping Pattern

## 34.1 Input wrapper

```java
InputStream old = context.getInputStream();
InputStream wrapped = new MyInputStream(old);
context.setInputStream(wrapped);
try {
    return context.proceed();
} finally {
    context.setInputStream(old);
}
```

## 34.2 Output wrapper

```java
OutputStream old = context.getOutputStream();
MyOutputStream wrapped = new MyOutputStream(old);
context.setOutputStream(wrapped);
try {
    context.proceed();
} finally {
    wrapped.finishIfNeeded();
    context.setOutputStream(old);
}
```

## 34.3 Why restore?

Avoid surprising downstream code after `proceed`.

Spec example restores old stream.

## 34.4 Finish matters

Some wrappers need finalization:

- `GZIPOutputStream.finish()`;
- cipher final block;
- signature finalization;
- checksum completion.

## 34.5 Rule

Wrap, proceed, finish/restore in `finally`.

---

# 35. Restoring Old Stream: Kapan Perlu, Kapan Tidak

## 35.1 Restore helps

- prevents side effects;
- aligns with spec examples;
- safer with nested interceptors;
- easier debugging.

## 35.2 Runtime closes currently set stream

Docs state runtime is responsible for closing streams set in context.

## 35.3 Wrapper close concern

If wrapper close closes underlying stream prematurely, prefer `finish()` and restore old stream.

## 35.4 Request input

After reader completes, input stream usually no longer needed.

Still restore in finally.

## 35.5 Rule

Default pattern: restore old stream in finally.

---

# 36. Closing, Flushing, dan Finishing Streams

## 36.1 Do not close underlying stream casually

Runtime owns stream lifecycle.

## 36.2 Finish compression

```java
gzip.finish();
```

not necessarily `close()`.

## 36.3 Flush

Flush only when needed; premature flush may commit response.

## 36.4 Cipher streams

Need final block/tag.

## 36.5 Digest streams

Digest after all bytes read/written.

## 36.6 Rule

Know wrapper stream semantics before putting it in interceptor.

---

# 37. Error Handling di Interceptor

Interceptors can throw:

```java
IOException
WebApplicationException
```

## 37.1 Request reader side

If request decompression/signature fails before resource method:

- 400 malformed encoded body;
- 401/403 invalid signature depending auth design;
- 413 too large;
- 415 unsupported content coding.

## 37.2 Writer side

If response writer side fails after commit, exception mapper may not produce clean error.

## 37.3 Problem Details

ReaderInterceptor can throw `WebApplicationException` with Problem Details response if before commit.

## 37.4 IOException

Usually maps to processing/server error unless handled.

## 37.5 Rule

Reader errors can be clean client errors. Writer errors may be late and messy.

---

# 38. Response Already Committed dan Writer Error

WriterInterceptor runs during response body writing.

## 38.1 Headers/status may commit

Once bytes are written/flushed, server may commit headers/status.

## 38.2 If error occurs after commit

Cannot reliably return Problem Details.

Client may see:

- truncated body;
- connection reset;
- partial content;
- invalid compressed stream.

## 38.3 Prevention

Validate early before writing.

For expensive generation, consider pre-generating output or async job.

## 38.4 GZIP finish error

If `finish()` fails, response may be broken.

Log with correlation ID.

## 38.5 Rule

Do not depend on exception mapper to fix late writer/interceptor failures.

---

# 39. Interceptor dan `StreamingOutput`

`StreamingOutput` writes response entity manually to output stream.

## 39.1 WriterInterceptor still wraps

WriterInterceptor can wrap output stream around `StreamingOutput` writer if the `MessageBodyWriter` for `StreamingOutput` uses the provided output stream.

## 39.2 Metrics

Counting output stream can measure streamed bytes.

## 39.3 Compression

Compressing streaming output is possible but errors late.

## 39.4 Content-Length

Usually unknown.

## 39.5 Rule

Streaming + interceptor requires careful error/flush/backpressure design.

---

# 40. Interceptor dan Multipart

Multipart involves multiple parts, each may have headers/media/body.

## 40.1 Whole entity interceptor

Reader/WriterInterceptor wraps entire multipart entity stream, not individual part semantics by default.

## 40.2 Per-part processing

Use multipart provider/EntityPart handling for part-level validation/processing.

## 40.3 Compression

Compressing entire multipart entity differs from compressing individual file part.

## 40.4 Rule

For part-level logic, use multipart processing/provider, not only global interceptor.

---

# 41. Interceptor dan Conditional Requests / ETag

## 41.1 ETag from response bytes

Could compute ETag by hashing serialized bytes.

Challenge:

- must know ETag before sending headers for conditional GET;
- hash known after body written.

## 41.2 Better

Use resource version/domain version for ETag.

```java
EntityTag tag = new EntityTag(resource.version());
```

## 41.3 Byte-based ETag

Requires precomputing or buffering.

## 41.4 Rule

Do not rely on WriterInterceptor byte hash for normal ETag unless buffering/precompute acceptable.

---

# 42. Interceptor dan Caching

## 42.1 Content-Encoding affects cache

Compressed and uncompressed representations differ.

Set:

```http
Vary: Accept-Encoding
```

## 42.2 Digest/signature headers

If body transformed, cache metadata must match transformed representation.

## 42.3 Private data

Do not make encrypted/signed/user-specific response cacheable accidentally.

## 42.4 Rule

Stream transformations affect cache correctness.

---

# 43. Interceptor dan Security

## 43.1 Compression side channels

Compressing secret and attacker-controlled input together can create side-channel risks in certain contexts.

## 43.2 Crypto

Use vetted libraries and security review.

## 43.3 Signature

Use constant-time comparison for MAC/signature.

## 43.4 Zip bomb

Limit decompressed size.

## 43.5 Body logs

Never log secrets.

## 43.6 Rule

Entity stream interceptors are security-sensitive by nature.

---

# 44. Interceptor dan Async/Non-Blocking Runtime

## 44.1 Classic JAX-RS

Interceptors are blocking stream wrappers.

## 44.2 Reactive runtimes

Some runtimes have non-blocking/reactive extensions where blocking stream interceptors may not be ideal.

## 44.3 Quarkus/RESTEasy Reactive

May require care with blocking annotations or reactive body handling.

## 44.4 Rule

If runtime is reactive/non-blocking, confirm interceptor compatibility and threading model.

---

# 45. Interceptor dan Gateway/Server Compression

## 45.1 Compression usually belongs outside app

Gateway/server compression can be:

- more optimized;
- centralized;
- consistently configured;
- aware of HTTP/2/3;
- easier to manage.

## 45.2 App-level compression still useful when

- application-specific encryption/signature;
- custom content coding;
- per-endpoint policy;
- test/demo;
- no gateway/server support.

## 45.3 Avoid double compression

If gateway compresses, app interceptor should not also compress.

## 45.4 Rule

Coordinate app interceptors with gateway/server behavior.

---

# 46. Testing Interceptors

## 46.1 Unit tests

Test stream wrapper logic separately.

Examples:

- gzip decompress wrapper;
- counting stream;
- digest stream;
- bounded stream;
- signature verification.

## 46.2 Runtime tests

Must use actual HTTP runtime to verify:

- registration/discovery;
- priority order;
- name binding;
- `proceed()` chain;
- headers;
- reader/writer integration;
- error mapping.

## 46.3 GZIP request test

Send gzipped JSON:

```http
Content-Type: application/json
Content-Encoding: gzip
```

Assert resource receives DTO.

## 46.4 GZIP response test

Send:

```http
Accept-Encoding: gzip
```

Assert:

```http
Content-Encoding: gzip
Vary: Accept-Encoding
```

and body decompresses.

## 46.5 Body hash test

Assert hash property/header/log equals expected bytes.

## 46.6 Failure test

- invalid gzip;
- oversized decompressed body;
- invalid signature;
- writer exception;
- missing `proceed` detection.

## 46.7 Rule

Interceptor behavior cannot be fully tested by direct resource method invocation.

---

# 47. Observability

## 47.1 Metrics

Useful:

```text
request_entity_bytes_total
response_entity_bytes_total
request_body_decode_errors_total
response_body_encode_errors_total
entity_interceptor_duration_seconds
```

## 47.2 Labels

Safe labels:

- route template;
- media type normalized;
- encoding;
- status class;
- interceptor name.

Avoid:

- raw path;
- raw body;
- user/customer ID;
- signature value;
- digest maybe unless carefully handled.

## 47.3 Logs

Log only metadata and failures.

## 47.4 Traces

Add events:

```text
request_body_decompressed
request_body_signature_verified
response_body_compressed
```

with safe attributes.

## 47.5 Rule

Observe entity processing without exposing entity content.

---

# 48. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 48.1 Standard contract

Interfaces and core behavior are standard.

## 48.2 Differences

- provider discovery;
- CDI injection;
- priority diagnostics;
- reactive behavior;
- default compression features;
- multipart interaction;
- exception wrapping;
- resource matching/binding details.

## 48.3 Jersey/RESTEasy docs

Both document filters/interceptors and may offer extensions.

## 48.4 Quarkus

Build-time registration and RESTEasy Reactive behavior should be verified.

## 48.5 Rule

Test interceptors on target runtime, especially if wrapping streams.

---

# 49. Migration: `javax.ws.rs.ext` ke `jakarta.ws.rs.ext`

## 49.1 Old imports

```java
import javax.ws.rs.ext.ReaderInterceptor;
import javax.ws.rs.ext.WriterInterceptor;
import javax.ws.rs.ext.ReaderInterceptorContext;
import javax.ws.rs.ext.WriterInterceptorContext;
import javax.ws.rs.ext.Provider;
```

## 49.2 New imports

```java
import jakarta.ws.rs.ext.ReaderInterceptor;
import jakarta.ws.rs.ext.WriterInterceptor;
import jakarta.ws.rs.ext.ReaderInterceptorContext;
import jakarta.ws.rs.ext.WriterInterceptorContext;
import jakarta.ws.rs.ext.Provider;
```

## 49.3 Mixed namespace trap

A `javax.ws.rs.ext.WriterInterceptor` is not a Jakarta REST 4 interceptor.

It will not be recognized by a `jakarta.ws.rs` runtime.

## 49.4 Also update

- `@NameBinding`;
- `@Priority`;
- `WebApplicationException`;
- `Response`;
- `MediaType`.

## 49.5 Rule

Migration includes interceptors, filters, providers, and annotations.

---

# 50. Common Failure Modes

## 50.1 Forgetting `proceed()`

Reader/writer never runs.

## 50.2 Calling `proceed()` twice

Body read/write duplicated or broken.

## 50.3 Shared mutable state

Concurrency bugs.

## 50.4 Wrong priority

Encryption/compression/signature order wrong.

## 50.5 Compressing without checking `Accept-Encoding`

Client receives unreadable body.

## 50.6 Setting `Content-Encoding` but not compressing

Protocol bug.

## 50.7 Not removing `Content-Length`

Wrong length after compression/encryption.

## 50.8 Logging body

PII leak.

## 50.9 Buffering huge response for signature

OutOfMemory.

## 50.10 Hashing wrong bytes

Wire vs representation mismatch.

## 50.11 Invalid gzip maps to 500

Should be client error if request body bad.

## 50.12 Writer error after commit

Cannot return clean Problem Details.

## 50.13 Old `javax` imports

Interceptor not discovered.

---

# 51. Best Practices

## 51.1 Use interceptor only for entity stream concerns

Not metadata-only concerns.

## 51.2 Call `proceed()` exactly once

Unless intentionally replacing pipeline.

## 51.3 Use explicit priority

Especially for compression/encryption/signature.

## 51.4 Use name binding

Avoid global transformations unless safe for all endpoints.

## 51.5 Do not log bodies

Use hash/metrics.

## 51.6 Avoid unbounded buffering

Especially response signing/body logging.

## 51.7 Respect HTTP headers

`Content-Encoding`, `Accept-Encoding`, `Vary`, `Content-Length`.

## 51.8 Finish wrapper streams

`GZIPOutputStream.finish()`, crypto finalization, etc.

## 51.9 Test via runtime

Registration/order/binding/proceed/provider integration.

## 51.10 Coordinate with gateway

Avoid double compression and conflicting headers.

---

# 52. Anti-Patterns

## 52.1 Using interceptor for authentication metadata

Use filter/security layer.

## 52.2 Parsing JSON manually in interceptor

Use MessageBodyReader or JSON provider.

## 52.3 Global compression for every response

Breaks binaries/already-compressed content.

## 52.4 Missing Vary

Cache bug.

## 52.5 Body logging as interceptor

Compliance/security risk.

## 52.6 Crypto homemade in interceptor

Security disaster.

## 52.7 Buffering all responses to add hash

Memory risk.

## 52.8 Ignoring `Content-Length`

Protocol mismatch.

## 52.9 Relying on manual provider calls to trigger interceptors

They do not.

## 52.10 No tests for malformed compressed input

Bad 500s.

---

# 53. Production Checklist

## 53.1 Scope and registration

- [ ] Interceptor has `@Provider` or explicit registration.
- [ ] Namespace is `jakarta.*`.
- [ ] Scope is global/name-bound/dynamic intentionally.
- [ ] Name binding tested.
- [ ] DynamicFeature tested if used.

## 53.2 Chain behavior

- [ ] `proceed()` called exactly once.
- [ ] Priority explicitly set where order matters.
- [ ] Same priority dependency avoided.
- [ ] Stream wrapper order documented.
- [ ] Old stream restored where appropriate.

## 53.3 HTTP correctness

- [ ] `Content-Encoding` correct.
- [ ] `Accept-Encoding` respected.
- [ ] `Vary` set.
- [ ] `Content-Length` removed/updated after transformation.
- [ ] Unsupported content coding handled.
- [ ] Errors mapped safely.

## 53.4 Security

- [ ] No body logs.
- [ ] Decompressed size limit.
- [ ] Signature/MAC constant-time compare.
- [ ] Crypto reviewed.
- [ ] No secrets in headers/logs.
- [ ] Gateway/server compression coordinated.

## 53.5 Performance

- [ ] No unbounded buffering.
- [ ] Large streaming tested.
- [ ] Wrapper streams efficient.
- [ ] Metrics not high-cardinality.
- [ ] Compression threshold considered.

## 53.6 Testing

- [ ] Unit tests for stream wrappers.
- [ ] Runtime tests for interceptors.
- [ ] Gzip request/response tests.
- [ ] Signature/hash tests.
- [ ] Error tests.
- [ ] Large payload tests.
- [ ] Provider migration tests.

---

# 54. Latihan

## Latihan 1 — GZIP Request ReaderInterceptor

Implement request decompression:

- only if `Content-Encoding: gzip`;
- pass decompressed stream to JSON reader;
- reject invalid gzip with Problem Details;
- enforce decompressed size limit.

## Latihan 2 — GZIP Response WriterInterceptor

Implement response compression:

- only if `Accept-Encoding` includes gzip;
- skip already compressed media;
- set `Content-Encoding`;
- add `Vary: Accept-Encoding`;
- remove `Content-Length`.

## Latihan 3 — Body Hash

Create `@BodyHash` name binding.

Compute SHA-256 of request representation bytes.

Store in request property.

Use in resource or response header.

## Latihan 4 — Invalid `proceed()`

Create interceptor that forgets `proceed()`.

Observe how body binding/writing breaks.

Then fix.

## Latihan 5 — Priority Order

Create two writer interceptors:

- one compresses;
- one hashes.

Test whether hash is compressed or uncompressed bytes.

Change priorities and observe.

## Latihan 6 — Signature Verification

Implement HMAC verification:

- header timestamp;
- header signature;
- stream MAC;
- constant-time compare;
- replay window.

## Latihan 7 — Response Signing

Implement buffered small-response signing.

Reject or skip if response exceeds max buffer size.

## Latihan 8 — Metrics Interceptor

Count request/response bytes.

Emit metrics with route template and media type.

No raw path/body.

## Latihan 9 — Migration Test

Replace `javax.ws.rs.ext.WriterInterceptor` imports with `jakarta.ws.rs.ext.WriterInterceptor`.

Verify interceptor discovery in Jakarta REST 4 runtime.

---

# 55. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `ReaderInterceptor` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/readerinterceptor

2. Jakarta RESTful Web Services 4.0 — `WriterInterceptor` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/writerinterceptor

3. Jakarta RESTful Web Services 4.0 — `ReaderInterceptorContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/readerinterceptorcontext

4. Jakarta RESTful Web Services 4.0 — `WriterInterceptorContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/writerinterceptorcontext

5. Jakarta RESTful Web Services 4.0 — `InterceptorContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/interceptorcontext

6. Jakarta RESTful Web Services 4.0 — `MessageBodyReader` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodyreader

7. Jakarta RESTful Web Services 4.0 — `MessageBodyWriter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodywriter

8. Jakarta RESTful Web Services 4.0 — `NameBinding` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/namebinding

9. Jakarta RESTful Web Services 4.0 — `Priorities` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/priorities

10. Jakarta RESTful Web Services 4.0 Specification — Entity Interceptors, Binding, Priorities  
    https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

11. Jersey Documentation — Filters and Interceptors  
    https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/filters-and-interceptors.html

12. RESTEasy User Guide — Interceptors and Filters  
    https://docs.resteasy.dev/5.0/userguide/html/ch31.html

13. RFC 9110 — HTTP Semantics  
    https://www.rfc-editor.org/rfc/rfc9110.html

---

# 56. Penutup

Interceptor adalah extension point untuk entity bytes.

Mental model final:

```text
ReaderInterceptor:
  InputStream wrapper around MessageBodyReader.readFrom

WriterInterceptor:
  OutputStream wrapper around MessageBodyWriter.writeTo
```

Gunakan interceptor untuk:

- compression/decompression;
- encryption/decryption;
- signature verification/signing;
- body digest/hash;
- byte metrics;
- stream-level payload limits.

Jangan gunakan interceptor untuk:

- normal authentication metadata;
- business logic;
- manual JSON parsing;
- response envelope umum yang lebih cocok di DTO/writer;
- body logging;
- unbounded buffering.

Prinsip final:

```text
Filter controls request/response metadata and flow.
Interceptor wraps entity stream.
Reader/Writer parses/serializes entity.
Service/domain owns business.
```

Top-tier JAX-RS engineer memastikan:

- `proceed()` benar;
- priority jelas;
- stream wrapper aman;
- headers sesuai bytes;
- compression/encryption/signature order benar;
- no body leak;
- no unbounded buffering;
- error handling realistis terutama after commit;
- runtime tests membuktikan chain berjalan.

Part berikutnya:

```text
Bagian 017 — Name Binding, DynamicFeature, Priorities, and Provider Lifecycle
```

Kita akan membahas extension binding secara sangat mendalam: global vs name-bound vs dynamic providers, multiple name bindings, priority ordering, provider lifecycle/thread safety, CDI integration, registration strategy, and production extension architecture.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-015.md](./learn-jaxrs-advanced-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-017.md](./learn-jaxrs-advanced-part-017.md)

</div>