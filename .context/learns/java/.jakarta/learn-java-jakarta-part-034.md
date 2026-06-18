# learn-java-jakarta-part-034.md

# Bagian 34 — Jakarta Activation (`jakarta.activation`): MIME Type, `DataHandler`, `DataSource`, Binary Content, Mail/SOAP Attachments, dan Content Handling

> Target pembaca: Java engineer yang ingin memahami Jakarta Activation bukan sebagai “dependency kecil yang muncul saat pakai Mail/SOAP”, tetapi sebagai **content handling abstraction**: bagaimana Java mengenali MIME type, membungkus arbitrary data, menyediakan stream, menghubungkan data dengan command/handler, dan menjadi fondasi untuk Jakarta Mail serta SOAP/XML attachment handling.
>
> Fokus bagian ini: Jakarta Activation 2.1 dalam Jakarta EE 11 Platform, sejarah JavaBeans Activation Framework/JAF, `DataHandler`, `DataSource`, `FileDataSource`, `URLDataSource`, `ByteArrayDataSource` pattern, `FileTypeMap`, `MimetypesFileTypeMap`, `CommandMap`, `MailcapCommandMap`, `DataContentHandler`, MIME detection, content type correctness, attachment streaming, security, performance, migration `javax.activation` → `jakarta.activation`, and production-grade binary/content boundary design.

---

## Daftar Isi

1. [Orientasi: Jakarta Activation Itu Apa?](#1-orientasi-jakarta-activation-itu-apa)
2. [Status Modern: Jakarta Activation 2.1 dalam Jakarta EE 11](#2-status-modern-jakarta-activation-21-dalam-jakarta-ee-11)
3. [Mental Model: Data + MIME Type + Handler + Commands](#3-mental-model-data--mime-type--handler--commands)
4. [Activation vs Mail vs SOAP Attachments vs File Upload](#4-activation-vs-mail-vs-soap-attachments-vs-file-upload)
5. [Dependency, Runtime, API, dan Implementation](#5-dependency-runtime-api-dan-implementation)
6. [Peta API `jakarta.activation`](#6-peta-api-jakartaactivation)
7. [`DataSource`: Abstraction untuk Arbitrary Data](#7-datasource-abstraction-untuk-arbitrary-data)
8. [`DataHandler`: Wrapper Utama Content Handling](#8-datahandler-wrapper-utama-content-handling)
9. [`FileDataSource`: File sebagai DataSource](#9-filedatasource-file-sebagai-datasource)
10. [`URLDataSource`: URL sebagai DataSource](#10-urldatasource-url-sebagai-datasource)
11. [Byte Array / In-Memory DataSource Pattern](#11-byte-array--in-memory-datasource-pattern)
12. [Streaming DataSource Pattern untuk Large Content](#12-streaming-datasource-pattern-untuk-large-content)
13. [`FileTypeMap` dan MIME Type Detection](#13-filetypemap-dan-mime-type-detection)
14. [`MimetypesFileTypeMap`: Mapping Extension ke MIME Type](#14-mimetypesfiletypemap-mapping-extension-ke-mime-type)
15. [`CommandMap` dan `MailcapCommandMap`](#15-commandmap-dan-mailcapcommandmap)
16. [`DataContentHandler`: Transformasi Object ↔ Bytes](#16-datacontenthandler-transformasi-object--bytes)
17. [`CommandInfo` dan Command Beans](#17-commandinfo-dan-command-beans)
18. [MIME Type Correctness dan Content-Type Boundary](#18-mime-type-correctness-dan-content-type-boundary)
19. [Jakarta Activation dalam Jakarta Mail](#19-jakarta-activation-dalam-jakarta-mail)
20. [Jakarta Activation dalam SOAP Attachments / SAAJ](#20-jakarta-activation-dalam-soap-attachments--saaj)
21. [Attachment Design: Filename, Content-Type, Size, Streaming](#21-attachment-design-filename-content-type-size-streaming)
22. [Security: MIME Spoofing, Path Traversal, SSRF, Malware](#22-security-mime-spoofing-path-traversal-ssrf-malware)
23. [Performance: Memory, Stream Lifecycle, Temp File](#23-performance-memory-stream-lifecycle-temp-file)
24. [Thread Safety dan Resource Lifecycle](#24-thread-safety-dan-resource-lifecycle)
25. [Custom `DataSource`: Kapan dan Bagaimana](#25-custom-datasource-kapan-dan-bagaimana)
26. [Custom MIME Map dan Content Handling](#26-custom-mime-map-dan-content-handling)
27. [Migration: `javax.activation` → `jakarta.activation`](#27-migration-javaxactivation--jakartaactivation)
28. [Java 11+ dan Activation Tidak Lagi dari JDK](#28-java-11-dan-activation-tidak-lagi-dari-jdk)
29. [Integration Patterns](#29-integration-patterns)
30. [Testing Strategy](#30-testing-strategy)
31. [Observability dan Operational Runbook](#31-observability-dan-operational-runbook)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices dan Anti-Patterns](#33-best-practices-dan-anti-patterns)
34. [Checklist Review](#34-checklist-review)
35. [Case Study 1: Email Attachment dengan Jakarta Mail](#35-case-study-1-email-attachment-dengan-jakarta-mail)
36. [Case Study 2: SOAP Attachment dengan `DataHandler`](#36-case-study-2-soap-attachment-dengan-datahandler)
37. [Case Study 3: MIME Type Salah dan Partner Menolak File](#37-case-study-3-mime-type-salah-dan-partner-menolak-file)
38. [Case Study 4: Attachment Besar Membuat Heap Naik](#38-case-study-4-attachment-besar-membuat-heap-naik)
39. [Latihan Bertahap](#39-latihan-bertahap)
40. [Mini Project: Jakarta Activation Content Handling Lab](#40-mini-project-jakarta-activation-content-handling-lab)
41. [Referensi Resmi](#41-referensi-resmi)

---

# 1. Orientasi: Jakarta Activation Itu Apa?

Jakarta Activation adalah spesifikasi yang menyediakan service standar untuk:

- menentukan MIME type dari arbitrary data;
- membungkus akses ke data;
- menemukan operasi/command yang tersedia untuk jenis data tersebut;
- menginstansiasi bean/handler yang tepat untuk operasi tertentu.

Nama historisnya adalah:

```text
JavaBeans Activation Framework / JAF
```

Package lama:

```java
javax.activation
```

Package modern:

```java
jakarta.activation
```

## 1.1 Kenapa sering tidak terlihat?

Banyak developer tidak memakai Jakarta Activation langsung.

Ia biasanya muncul sebagai dependency transitive dari:

- Jakarta Mail;
- SOAP attachments;
- JAX-WS/SAAJ stack;
- MIME processing;
- document attachment handling.

Kamu mungkin baru sadar saat error:

```text
ClassNotFoundException: jakarta.activation.DataSource
```

atau:

```text
NoClassDefFoundError: javax/activation/DataHandler
```

## 1.2 Problem yang diselesaikan

Bayangkan aplikasi perlu mengirim email attachment.

Attachment bisa berasal dari:

- file;
- byte array;
- object store stream;
- database BLOB;
- generated report;
- URL;
- SOAP attachment;
- uploaded file.

Semua itu perlu disajikan secara seragam sebagai:

```text
content stream + MIME type + name
```

Jakarta Activation memberi abstraksi:

```java
DataSource
DataHandler
```

## 1.3 Kenapa MIME type penting?

Content tidak cukup hanya berupa bytes.

Receiver perlu tahu:

```text
application/pdf
image/png
text/plain; charset=UTF-8
application/xml
application/octet-stream
```

MIME type menentukan cara content diperlakukan.

## 1.4 Prinsip utama

```text
Jakarta Activation is a content abstraction layer.
It does not own business logic; it describes and exposes data content safely.
```

---

# 2. Status Modern: Jakarta Activation 2.1 dalam Jakarta EE 11

Jakarta Activation 2.1 adalah release untuk Jakarta EE 10.

Namun berbeda dari XML Binding, XML Web Services, dan SOAP with Attachments, Jakarta Activation 2.1 tetap tercantum dalam Jakarta EE 11 Platform.

## 2.1 Jakarta EE 11 Platform

Jakarta EE 11 Platform mencantumkan:

```text
Activation 2.1
```

Jadi aplikasi Jakarta EE 11 Platform-compatible dapat mengharapkan Activation sebagai bagian platform, meskipun dependency explicit tetap sering berguna untuk compile/test toolchain.

## 2.2 Jakarta Activation 2.2

Jakarta Activation 2.2 sedang dikembangkan untuk Jakarta EE 12.

Target seri ini: Jakarta EE 11, jadi versi yang relevan adalah Activation 2.1.

## 2.3 Package modern

```java
jakarta.activation
```

## 2.4 Hubungan dengan Jakarta Mail

Jakarta Mail memakai Jakarta Activation untuk content/attachment handling.

## 2.5 Hubungan dengan SOAP stack

Jakarta SOAP with Attachments/JAX-WS juga menggunakan Activation untuk attachment content.

Walaupun SOAP stack removed from Jakarta EE 11 Platform, Activation tetap ada.

## 2.6 Practical implication

Jika kamu membuat:

- mail attachment;
- SOAP attachment;
- MIME content wrapper;
- document transfer adapter;

Activation tetap relevan.

---

# 3. Mental Model: Data + MIME Type + Handler + Commands

Jakarta Activation memodelkan content sebagai:

```text
Data
  + content type / MIME type
  + name
  + input stream
  + optional output stream
  + handler/commands for that MIME type
```

## 3.1 DataSource

`DataSource` menjawab:

```text
What is your content type?
What is your name?
How can I read bytes?
Can I write bytes?
```

## 3.2 DataHandler

`DataHandler` adalah wrapper higher-level yang menggunakan `DataSource` atau object + MIME type.

Ia bisa:

- expose input stream;
- expose output stream;
- expose content type;
- retrieve commands;
- write content to stream;
- provide transfer data flavors in desktop-like environments.

## 3.3 FileTypeMap

Menentukan MIME type dari file name.

## 3.4 CommandMap

Menentukan command/handler untuk MIME type.

## 3.5 DataContentHandler

Mengubah content object menjadi byte stream dan sebaliknya untuk MIME type tertentu.

## 3.6 Runtime flow

```text
DataSource
  ↓ exposes stream + contentType
DataHandler
  ↓ asks CommandMap by MIME type
DataContentHandler / command
  ↓ performs operation/read/write/view/edit
```

## 3.7 Enterprise usage simplification

Dalam server-side enterprise apps, bagian “command/view/edit bean” jarang dipakai langsung.

Yang paling sering dipakai:

```text
DataSource + DataHandler + content type
```

untuk attachments.

---

# 4. Activation vs Mail vs SOAP Attachments vs File Upload

## 4.1 Jakarta Activation

Content abstraction.

## 4.2 Jakarta Mail

Email framework.

Uses Activation for message body parts and attachments.

## 4.3 SOAP Attachments/SAAJ

SOAP message API with attachments.

Uses Activation `DataHandler`/`DataSource` for attachment content.

## 4.4 File upload

Servlet multipart upload gives `Part`.

You can adapt uploaded file to `DataSource` if needed.

## 4.5 Object storage

S3/blob/object store stream can be wrapped into custom `DataSource`.

## 4.6 Decision table

| Need | Use |
|---|---|
| Send file as email attachment | Jakarta Mail + Activation |
| Attach binary to SOAP | SAAJ/JAX-WS + Activation |
| Represent arbitrary content stream | `DataSource` |
| Wrap content for APIs expecting Activation | `DataHandler` |
| Detect MIME by extension | `FileTypeMap` / `MimetypesFileTypeMap` |
| Detect MIME by magic bytes | external library/custom detection |
| Upload browser file | Servlet multipart `Part` |
| Store large file | object storage/temp file + streaming DataSource |

## 4.7 Activation is not storage

It does not store files by itself.

It abstracts access.

---

# 5. Dependency, Runtime, API, dan Implementation

## 5.1 API dependency

Example:

```xml
<dependency>
  <groupId>jakarta.activation</groupId>
  <artifactId>jakarta.activation-api</artifactId>
  <version>2.1.3</version>
</dependency>
```

In Jakarta EE Platform runtime, API may be provided.

For standalone apps/tests/libraries, add explicit dependency.

## 5.2 Implementation

Jakarta Activation API jar provides many core classes.

Some content handler/command behavior can involve implementation/provider resources.

In practice, many projects depend on:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>angus-activation</artifactId>
  <version>...</version>
</dependency>
```

or get it transitively through Jakarta Mail implementation.

## 5.3 Compile vs runtime

If you compile against `jakarta.activation-api` but runtime lacks it, app fails.

If Jakarta EE server provides it, use `provided` scope where appropriate.

## 5.4 Java 11+

Activation is not part of modern JDK.

Add dependencies explicitly outside Jakarta EE platform.

## 5.5 Namespace mismatch

Old:

```java
javax.activation.DataHandler
```

New:

```java
jakarta.activation.DataHandler
```

They are different packages.

## 5.6 Common transitive issue

Using Jakarta Mail with old JavaMail/JAF dependencies can cause:

```text
javax.activation.DataContentHandler not found
```

or class conflicts.

## 5.7 Rule

```text
Mail, Activation, SOAP/JAX-WS stack must all agree on javax vs jakarta.
```

---

# 6. Peta API `jakarta.activation`

Important types:

- `DataHandler`;
- `DataSource`;
- `FileDataSource`;
- `URLDataSource`;
- `FileTypeMap`;
- `MimetypesFileTypeMap`;
- `CommandMap`;
- `MailcapCommandMap`;
- `CommandInfo`;
- `DataContentHandler`;
- `DataContentHandlerFactory`;
- `ActivationDataFlavor`;
- `MimeType`;
- `MimeTypeParameterList`;
- `MimeTypeParseException`;
- `UnsupportedDataTypeException`.

## 6.1 Data abstraction

```java
DataSource
DataHandler
```

## 6.2 MIME type

```java
FileTypeMap
MimetypesFileTypeMap
MimeType
MimeTypeParameterList
```

## 6.3 Command/handler

```java
CommandMap
MailcapCommandMap
CommandInfo
DataContentHandler
```

## 6.4 Common enterprise subset

Most server apps need:

```java
DataSource
DataHandler
FileDataSource
```

plus sometimes custom `DataSource`.

## 6.5 Advanced subset

Desktop/command handling and `CommandMap` is less common in server apps but important for completeness and spec understanding.

---

# 7. `DataSource`: Abstraction untuk Arbitrary Data

`DataSource` is an interface.

It abstracts arbitrary data.

## 7.1 Methods

Conceptually:

```java
InputStream getInputStream() throws IOException;
OutputStream getOutputStream() throws IOException;
String getContentType();
String getName();
```

## 7.2 Read

`getInputStream()` provides bytes.

## 7.3 Write

`getOutputStream()` may be unsupported for read-only source.

## 7.4 Content type

`getContentType()` returns MIME type.

## 7.5 Name

`getName()` is name of data object, often filename-like.

## 7.6 Why DataSource?

Because the same API can represent:

- file;
- URL resource;
- byte array;
- database BLOB;
- object storage stream;
- generated report;
- in-memory content;
- uploaded file.

## 7.7 Design rule

A `DataSource` should make clear:

```text
Can it be read multiple times?
Does getInputStream return fresh stream each call?
Is content length known?
Who closes stream?
What MIME type is declared?
```

## 7.8 Common gotcha

Some APIs may call `getInputStream()` more than once.

If your DataSource wraps one-time stream, it may fail.

Prefer repeatable source for Mail attachments unless library docs guarantee single read.

---

# 8. `DataHandler`: Wrapper Utama Content Handling

`DataHandler` wraps a `DataSource` or object plus MIME type.

## 8.1 From DataSource

```java
DataSource source = new FileDataSource(file);
DataHandler handler = new DataHandler(source);
```

## 8.2 From object

```java
DataHandler handler = new DataHandler("hello", "text/plain; charset=UTF-8");
```

## 8.3 Get input stream

```java
try (InputStream in = handler.getInputStream()) {
    ...
}
```

## 8.4 Get content type

```java
String contentType = handler.getContentType();
```

## 8.5 Get name

```java
String name = handler.getName();
```

## 8.6 Write to output stream

```java
handler.writeTo(outputStream);
```

## 8.7 Use in Mail

Jakarta Mail attachment body part can use `DataHandler`.

## 8.8 Use in SOAP

SAAJ attachment can use `DataHandler`.

## 8.9 It is not magic

`DataHandler` does not make content safe.

It just wraps content.

Security/validation still your responsibility.

---

# 9. `FileDataSource`: File sebagai DataSource

`FileDataSource` wraps a local file.

## 9.1 Example

```java
File file = Path.of("report.pdf").toFile();

DataSource source = new FileDataSource(file);
DataHandler handler = new DataHandler(source);
```

## 9.2 Content type

`FileDataSource` uses `FileTypeMap` to determine content type.

## 9.3 Name

Usually file name.

## 9.4 Input stream

Opens file input stream.

## 9.5 Output stream

May allow writing to file.

## 9.6 Security caution

Do not create `FileDataSource` from untrusted path.

Path traversal risk.

## 9.7 Large file

FileDataSource can be good for large attachments because content can be streamed from disk.

But actual consuming API may still buffer.

Test.

## 9.8 Temp file lifecycle

If file is temporary, ensure cleanup after send/process completes.

---

# 10. `URLDataSource`: URL sebagai DataSource

`URLDataSource` wraps a URL.

## 10.1 Example

```java
URL url = new URL("https://example.com/file.pdf");
DataSource source = new URLDataSource(url);
DataHandler handler = new DataHandler(source);
```

## 10.2 Use cases

- remote resource attachment;
- internal static resource;
- test/demo.

## 10.3 SSRF risk

Never create URLDataSource from untrusted user URL.

It can make server request internal networks.

## 10.4 Timeout

URL stream behavior may have default timeouts.

Need explicit control if used in production.

## 10.5 Availability

Remote resource can fail during read.

## 10.6 Repeatability

Each `getInputStream()` opens URL connection again.

Could produce inconsistent content.

## 10.7 Recommendation

For production, fetch remote content in controlled client, validate/store it, then expose via FileDataSource/custom DataSource.

---

# 11. Byte Array / In-Memory DataSource Pattern

Jakarta Activation API may not always provide a built-in ByteArrayDataSource in core API.

Jakarta Mail implementations often provide utility classes such as `ByteArrayDataSource`.

You can implement your own.

## 11.1 Simple implementation

```java
public final class ByteArrayDataSource implements DataSource {
    private final byte[] data;
    private final String contentType;
    private final String name;

    public ByteArrayDataSource(byte[] data, String contentType, String name) {
        this.data = data.clone();
        this.contentType = contentType;
        this.name = name;
    }

    @Override
    public InputStream getInputStream() {
        return new ByteArrayInputStream(data);
    }

    @Override
    public OutputStream getOutputStream() {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public String getContentType() {
        return contentType;
    }

    @Override
    public String getName() {
        return name;
    }
}
```

## 11.2 Pros

- repeatable;
- simple;
- good for small content.

## 11.3 Cons

- stores entire content in heap;
- bad for large attachments;
- data clone doubles memory.

## 11.4 Use cases

- small generated text;
- test fixtures;
- small PDFs;
- small XML document.

## 11.5 Avoid for

- multi-MB/GB attachments;
- high-concurrency large sends;
- unbounded user uploads.

## 11.6 Safer rule

Use byte array only when size bounded and small.

---

# 12. Streaming DataSource Pattern untuk Large Content

For large content, implement streaming DataSource.

## 12.1 Object storage example

```java
public final class ObjectStorageDataSource implements DataSource {
    private final ObjectStorageClient client;
    private final String bucket;
    private final String key;
    private final String contentType;
    private final String name;

    @Override
    public InputStream getInputStream() throws IOException {
        return client.openStream(bucket, key);
    }

    @Override
    public OutputStream getOutputStream() {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public String getContentType() {
        return contentType;
    }

    @Override
    public String getName() {
        return name;
    }
}
```

## 12.2 Repeatable stream

Each `getInputStream()` should return a new stream.

This is often required.

## 12.3 Error handling

If remote stream fails mid-send, caller sees IO exception.

## 12.4 Timeout

Object storage client must have timeout.

## 12.5 Security

Validate object key and permissions before exposing.

## 12.6 Lifecycle

Caller closes stream.

Your DataSource should document this.

## 12.7 Content length

DataSource API does not expose length.

Some APIs may not know size.

If size matters, carry metadata separately.

## 12.8 Backpressure

Large streaming attachments can tie resources for a long time.

Limit concurrency.

---

# 13. `FileTypeMap` dan MIME Type Detection

`FileTypeMap` provides data typing interface for files.

## 13.1 Default map

```java
FileTypeMap map = FileTypeMap.getDefaultFileTypeMap();
String type = map.getContentType("report.pdf");
```

## 13.2 Set default

```java
FileTypeMap.setDefaultFileTypeMap(customMap);
```

Be careful: global effect.

## 13.3 File extension based

Default detection is often extension-based, not magic byte based.

## 13.4 Example

```text
.pdf → application/pdf
.txt → text/plain
.xml → application/xml
```

## 13.5 Security warning

File extension is untrusted.

`invoice.pdf` might contain JavaScript/HTML/malware.

## 13.6 Use stronger detection

For security-sensitive uploads/attachments, use:

- magic byte detection;
- antivirus/malware scan;
- allowlist;
- content inspection;
- business validation.

## 13.7 Content-type contract

MIME type should be explicitly set from trusted metadata where possible.

---

# 14. `MimetypesFileTypeMap`: Mapping Extension ke MIME Type

`MimetypesFileTypeMap` maps file extensions using MIME type entries.

## 14.1 Example

```java
MimetypesFileTypeMap map = new MimetypesFileTypeMap();
map.addMimeTypes("application/pdf pdf");
map.addMimeTypes("text/csv csv");
```

## 14.2 Get type

```java
String type = map.getContentType("data.csv");
```

## 14.3 Sources

It can load from standard mime.types files depending implementation.

## 14.4 Custom maps

Useful if your app needs custom extensions:

```text
application/vnd.mycompany.report myrpt
```

## 14.5 Global vs local

Prefer local map for specific logic.

Setting global default can affect other libraries.

## 14.6 Extension ambiguity

Extensions are not enough for security.

## 14.7 Testing

Test expected filenames and unknown extension fallback.

---

# 15. `CommandMap` dan `MailcapCommandMap`

`CommandMap` maps MIME type to available commands.

`MailcapCommandMap` uses mailcap files/entries.

## 15.1 Historical purpose

Originally for desktop/JavaBeans activation:

```text
For image/png, what commands can view/edit/print it?
```

## 15.2 Server-side usage

Less common directly in server apps.

But it supports content handler lookup used by DataHandler.

## 15.3 Get default

```java
CommandMap map = CommandMap.getDefaultCommandMap();
```

## 15.4 Set default

```java
CommandMap.setDefaultCommandMap(custom);
```

Global side effect.

## 15.5 Mailcap entries

Mailcap maps MIME type to handler classes.

## 15.6 Production caution

Global command map changes can affect Jakarta Mail/Activation behavior across app.

## 15.7 Keep simple

Most backend apps do not need custom CommandMap unless implementing custom content handlers.

---

# 16. `DataContentHandler`: Transformasi Object ↔ Bytes

`DataContentHandler` handles conversion for specific MIME type.

## 16.1 Responsibilities

- represent content as object;
- write object to output stream;
- expose data flavors.

## 16.2 Used by DataHandler

DataHandler can delegate to DataContentHandler based on content type.

## 16.3 Example use

For `text/plain`, handler knows how to turn String into bytes.

## 16.4 Custom handler

Rare in backend apps, but possible for custom MIME types.

## 16.5 Implementation complexity

Must handle:

- charset;
- stream lifecycle;
- content object type;
- unsupported types;
- thread safety.

## 16.6 Prefer explicit code

For business apps, often easier to explicitly serialize content yourself and wrap in DataSource.

## 16.7 Security

Handlers parsing content must be secure.

---

# 17. `CommandInfo` dan Command Beans

`CommandInfo` describes a command available for MIME content.

## 17.1 Concept

For content type:

```text
image/png
```

available commands might be:

```text
view
edit
print
```

## 17.2 Backend relevance

Rarely used directly in modern server apps.

## 17.3 Historical desktop JavaBeans

Activation was designed for applications to discover operations on arbitrary data.

## 17.4 Still part of spec

Important for understanding why Activation has CommandMap/CommandInfo.

## 17.5 Do not over-engineer

If you just need email attachment, you likely do not need command beans.

---

# 18. MIME Type Correctness dan Content-Type Boundary

MIME type is contract.

## 18.1 Examples

```text
application/pdf
image/png
text/plain; charset=UTF-8
text/csv; charset=UTF-8
application/xml
application/json
application/octet-stream
```

## 18.2 Why correctness matters

Receivers use content type to:

- render;
- parse;
- validate;
- choose handler;
- enforce security;
- store metadata.

## 18.3 Wrong MIME type consequences

- email client displays incorrectly;
- partner rejects file;
- SOAP attachment not recognized;
- security scanner misclassifies;
- downstream parser fails.

## 18.4 Charset

Text content should include charset.

```text
text/plain; charset=UTF-8
text/csv; charset=UTF-8
```

## 18.5 Binary fallback

`application/octet-stream` means generic binary.

Use only if specific type unknown.

## 18.6 Trust hierarchy

Prefer MIME type from trusted generation process.

Do not trust user-supplied MIME type alone.

## 18.7 File extension

Extension can inform, not prove.

---

# 19. Jakarta Activation dalam Jakarta Mail

Jakarta Mail uses Activation for content and attachments.

## 19.1 Attachment example

```java
MimeBodyPart attachment = new MimeBodyPart();

DataSource source = new FileDataSource(file);
attachment.setDataHandler(new DataHandler(source));
attachment.setFileName(file.getName());
```

## 19.2 Inline image

```java
MimeBodyPart image = new MimeBodyPart();
image.setDataHandler(new DataHandler(new FileDataSource(imageFile)));
image.setHeader("Content-ID", "<logo>");
image.setDisposition(MimeBodyPart.INLINE);
```

## 19.3 Content type

FileDataSource determines type via FileTypeMap.

Can override where needed.

## 19.4 Large attachment

Mail library may stream or buffer depending transport/content.

Test realistic sizes.

## 19.5 Email security

- validate filename;
- size limit;
- content type allowlist;
- scan attachments;
- avoid sending secrets accidentally.

## 19.6 Repeatability

SMTP send may read attachment stream.

Ensure DataSource provides stable stream.

## 19.7 Failure handling

If attachment stream fails during send, email send fails.

---

# 20. Jakarta Activation dalam SOAP Attachments / SAAJ

SAAJ attachments can use DataHandler.

## 20.1 Example

```java
DataHandler handler = new DataHandler(new FileDataSource(file));

AttachmentPart part = message.createAttachmentPart(handler);
part.setContentId("<document1>");
message.addAttachmentPart(part);
```

## 20.2 Content ID

Used to reference attachment.

## 20.3 Content type

Comes from DataHandler/DataSource.

## 20.4 Large attachment

Check whether runtime streams or buffers.

## 20.5 MTOM

JAX-WS MTOM often uses DataHandler for binary content.

## 20.6 Security

Same attachment rules:

- size limit;
- type validation;
- malware scan;
- no raw filename trust.

## 20.7 Interop

Partner must understand attachment mechanism/content type.

---

# 21. Attachment Design: Filename, Content-Type, Size, Streaming

Attachment is not just bytes.

## 21.1 Metadata

Need:

- filename/display name;
- content type;
- size;
- checksum;
- content ID;
- disposition;
- charset if text;
- creation source;
- security classification.

## 21.2 Filename

Sanitize.

Do not allow path separators.

Normalize Unicode if needed.

## 21.3 Content-Type

Set explicitly and correctly.

## 21.4 Size

Enforce max size.

## 21.5 Streaming

For large files, avoid byte array.

## 21.6 Checksum

Use SHA-256 for audit/dedup.

## 21.7 Disposition

Email:

```text
attachment
inline
```

## 21.8 Lifecycle

Know when temporary file/object can be deleted.

---

# 22. Security: MIME Spoofing, Path Traversal, SSRF, Malware

## 22.1 MIME spoofing

User uploads `invoice.pdf` but content is executable/HTML.

Do not trust extension or browser-provided content type.

## 22.2 Path traversal

Bad:

```java
new File(uploadDir, userFilename)
```

with filename:

```text
../../secret.txt
```

Sanitize and generate server-side filename.

## 22.3 SSRF

`URLDataSource` from user URL can fetch internal resources.

Block/allowlist.

## 22.4 Malware

Attachments may contain malicious files.

Scan where required.

## 22.5 Archive bombs

Zip/PDF/Office files can be malicious or decompression bombs.

## 22.6 PII leak

Sending wrong attachment is data breach.

Use authorization and audit.

## 22.7 Content sniffing

Receivers may sniff content differently.

Set `Content-Type` and security headers in HTTP contexts.

## 22.8 Rule

```text
Activation wraps content; it does not validate content.
```

Validation is your job.

---

# 23. Performance: Memory, Stream Lifecycle, Temp File

## 23.1 Byte array risk

Byte arrays keep full content in heap.

At high concurrency, OOM.

## 23.2 File-backed content

Safer for large content.

## 23.3 Object storage streaming

Good for cloud architectures, but network failures/timeouts must be handled.

## 23.4 Repeatable streams

Some frameworks need to read multiple times.

## 23.5 Temp files

Use temp files for generated large reports.

Clean them up.

## 23.6 Content length absence

DataSource does not expose length.

Carry size separately when needed.

## 23.7 Backpressure

Limit concurrent large sends.

## 23.8 Benchmark

Test with real attachment sizes and concurrency.

## 23.9 Avoid eager `getContent`

`DataHandler.getContent()` may materialize content.

Prefer streaming when possible.

---

# 24. Thread Safety dan Resource Lifecycle

## 24.1 DataSource

Thread safety depends implementation.

Immutable FileDataSource-like objects are easier.

## 24.2 DataHandler

Treat as wrapper; avoid sharing mutable handler across unrelated requests if underlying source mutable.

## 24.3 InputStream

Each call returns stream.

Caller closes stream.

## 24.4 OutputStream

Often unsupported.

If supported, document behavior.

## 24.5 Factory globals

`FileTypeMap.setDefaultFileTypeMap` and `CommandMap.setDefaultCommandMap` affect global state.

Use carefully.

## 24.6 Temporary content

Delete after use.

But not before async mail/send operation reads it.

## 24.7 Race condition

If temp file is deleted while mail sender still reading, send fails.

## 24.8 Lifecycle design

For async send:

```text
create attachment content
store stable location
enqueue send job
send reads DataSource
delete after success/expiry
```

---

# 25. Custom `DataSource`: Kapan dan Bagaimana

## 25.1 When

Implement custom DataSource for:

- object storage;
- database BLOB;
- generated report stream;
- encrypted content;
- repeatable memory/file hybrid;
- multipart upload adapter.

## 25.2 Requirements

Provide:

- fresh input stream;
- correct content type;
- safe name;
- optional output stream or unsupported;
- clear lifecycle.

## 25.3 Example: read-only streaming

```java
public final class ReadOnlyDataSource implements DataSource {
    private final Supplier<InputStream> streamSupplier;
    private final String contentType;
    private final String name;

    public ReadOnlyDataSource(
            Supplier<InputStream> streamSupplier,
            String contentType,
            String name) {
        this.streamSupplier = streamSupplier;
        this.contentType = contentType;
        this.name = name;
    }

    @Override
    public InputStream getInputStream() {
        return streamSupplier.get();
    }

    @Override
    public OutputStream getOutputStream() {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public String getContentType() {
        return contentType;
    }

    @Override
    public String getName() {
        return name;
    }
}
```

## 25.4 Supplier caution

Supplier must return fresh stream.

## 25.5 Exception handling

`DataSource.getInputStream` declares IOException.

Wrap supplier errors appropriately.

## 25.6 Security

Validate source and permission before constructing DataSource.

## 25.7 Test multiple reads

Call `getInputStream()` twice in tests.

---

# 26. Custom MIME Map dan Content Handling

## 26.1 Custom MIME map

```java
MimetypesFileTypeMap map = new MimetypesFileTypeMap();
map.addMimeTypes("application/vnd.company.report rpt");
```

## 26.2 Local usage

```java
String type = map.getContentType("summary.rpt");
```

## 26.3 Global default

```java
FileTypeMap.setDefaultFileTypeMap(map);
```

Avoid unless intentional.

## 26.4 Custom content handler

Rare.

Useful if you need DataHandler to convert object type to content type.

## 26.5 Prefer explicit serialization

Instead of complex DataContentHandler, many backend apps do:

```text
object → bytes/stream
bytes/stream → DataSource
DataHandler wraps DataSource
```

## 26.6 Governance

Custom MIME types should be documented.

## 26.7 Partner contracts

If partner requires specific MIME type, hard-code/constant it from contract, not guessed from filename.

---

# 27. Migration: `javax.activation` → `jakarta.activation`

## 27.1 Package rename

Old:

```java
javax.activation.DataHandler
javax.activation.DataSource
javax.activation.FileDataSource
```

New:

```java
jakarta.activation.DataHandler
jakarta.activation.DataSource
jakarta.activation.FileDataSource
```

## 27.2 Dependencies

Old:

```xml
javax.activation:activation
com.sun.activation:javax.activation
```

New:

```xml
jakarta.activation:jakarta.activation-api
org.eclipse.angus:angus-activation
```

depending runtime.

## 27.3 Jakarta Mail migration

Old JavaMail:

```java
javax.mail
javax.activation
```

New Jakarta Mail:

```java
jakarta.mail
jakarta.activation
```

## 27.4 SOAP migration

Old SAAJ/JAX-WS:

```java
javax.xml.soap
javax.xml.ws
javax.activation
```

New:

```java
jakarta.xml.soap
jakarta.xml.ws
jakarta.activation
```

## 27.5 Mixed namespace problem

A method expecting `jakarta.activation.DataHandler` cannot accept `javax.activation.DataHandler`.

They are different types.

## 27.6 Generated code

Regenerate stubs/classes if generated SOAP/XML code imports old activation.

## 27.7 Transitive dependencies

Use dependency tree.

Remove old activation jars.

## 27.8 Test

- send email attachment;
- SOAP attachment;
- custom DataSource;
- MIME detection;
- runtime container packaging.

---

# 28. Java 11+ dan Activation Tidak Lagi dari JDK

JavaBeans Activation Framework was historically associated with Java SE/Java EE era APIs.

Modern Java no longer provides many Java EE APIs.

## 28.1 Symptom

```text
ClassNotFoundException: javax.activation.DataSource
```

or:

```text
ClassNotFoundException: jakarta.activation.DataSource
```

## 28.2 Fix

Add explicit dependency or rely on Jakarta EE Platform runtime if applicable.

## 28.3 Java 21

For Java 21 standalone app using Jakarta Mail, explicitly add Mail implementation which brings Activation or add Activation dependency yourself.

## 28.4 Build tool

Ensure tests have same classpath as runtime.

## 28.5 Docker issue

Sometimes works locally via IDE but fails in Docker because dependency not packaged.

Verify final image/libs.

## 28.6 Rule

```text
Do not rely on JDK to provide Activation in modern Java.
```

---

# 29. Integration Patterns

## 29.1 Email generated report

```text
generate report to temp file
  ↓ FileDataSource
  ↓ DataHandler
  ↓ MimeBodyPart attachment
  ↓ send mail
  ↓ cleanup temp file after success/retention
```

## 29.2 SOAP binary attachment

```text
object storage file
  ↓ streaming DataSource
  ↓ DataHandler
  ↓ AttachmentPart / MTOM
  ↓ SOAP send
```

## 29.3 Upload to email

```text
Servlet Part
  ↓ validate/scan/store
  ↓ DataSource from stored file
  ↓ DataHandler
  ↓ mail attachment
```

## 29.4 Dynamic content

```text
generate CSV stream
  ↓ temp file or repeatable stream DataSource
  ↓ correct text/csv; charset=UTF-8
```

## 29.5 Avoid direct user URL

Bad:

```text
user URL → URLDataSource → email/SOAP
```

Risk SSRF.

Fetch/validate/store first.

## 29.6 Anti-corruption

Activation types should stay at integration boundary, not domain model.

---

# 30. Testing Strategy

## 30.1 Unit test DataSource

Assert:

- content type;
- name;
- bytes match;
- multiple reads work;
- output unsupported if read-only.

## 30.2 MIME detection tests

Test:

- known extension;
- unknown extension;
- uppercase extension;
- no extension;
- custom extension.

## 30.3 Security tests

- malicious filename;
- path traversal;
- wrong content type;
- huge file;
- URL SSRF attempt.

## 30.4 Mail integration test

Generate MIME message and inspect attachment headers/content.

## 30.5 SOAP attachment test

Create SOAPMessage and verify AttachmentPart metadata.

## 30.6 Large content test

Send/process realistic large attachment.

Measure heap.

## 30.7 Migration test

Ensure no `javax.activation` in dependency tree.

## 30.8 Docker/runtime test

Run same packaged artifact in container.

## 30.9 Cleanup test

Temp files removed after processing.

---

# 31. Observability dan Operational Runbook

## 31.1 Metrics

Track:

- attachments sent;
- total bytes sent;
- content type distribution;
- attachment failure count;
- stream open failures;
- malware rejection;
- size rejection;
- MIME mismatch count;
- temp file cleanup failures.

## 31.2 Logs

Log metadata only:

- attachment ID;
- filename sanitized;
- content type;
- size;
- checksum;
- operation;
- correlation ID.

## 31.3 Do not log content

No binary dump.

No full PII attachment content.

## 31.4 Runbook questions

1. What content type was declared?
2. What file size?
3. What checksum?
4. Was stream readable?
5. Was file temp/object storage accessible?
6. Did send fail while reading content?
7. Did partner reject MIME type?
8. Was malware scan passed?
9. Was cleanup done?

## 31.5 Audit

For regulated systems, store:

- original file hash;
- generated attachment hash;
- send timestamp;
- recipient/partner;
- retention policy.

## 31.6 Alerting

Alert on:

- repeated attachment send failures;
- temp storage high;
- malware rejection spike;
- MIME mismatch spike;
- large content OOM risk.

---

# 32. Production Failure Modes

## 32.1 Missing Activation class

Dependency/runtime missing.

## 32.2 Javax/Jakarta mismatch

Library expects `javax.activation`, app has `jakarta.activation`, or vice versa.

## 32.3 Wrong MIME type

Partner/email client rejects or misinterprets content.

## 32.4 File not found

Temp file deleted before DataHandler reads it.

## 32.5 One-time stream reused

DataSource returns same consumed stream.

Second read empty/fails.

## 32.6 Memory OOM

ByteArrayDataSource for huge file under concurrency.

## 32.7 Path traversal

Untrusted filename used as filesystem path.

## 32.8 SSRF

URLDataSource created from user URL.

## 32.9 Malware attachment

No scanning/validation.

## 32.10 Global FileTypeMap changed

Unexpected MIME type behavior across app.

## 32.11 OutputStream unsupported

Caller assumes writeable DataSource.

## 32.12 Content length unknown

Downstream cannot enforce limits.

## 32.13 Docker runtime missing jar

Works in IDE, fails in container.

---

# 33. Best Practices dan Anti-Patterns

## 33.1 Best practices

- Treat Activation as integration boundary abstraction.
- Use explicit content type from trusted source.
- Use `DataHandler`/`DataSource` for Mail/SOAP attachments.
- Use file/object-storage-backed DataSource for large content.
- Ensure `getInputStream()` returns fresh stream.
- Sanitize filenames.
- Enforce size limits.
- Validate/scan attachments.
- Avoid `URLDataSource` from untrusted input.
- Avoid global `FileTypeMap`/`CommandMap` changes unless intentional.
- Keep Activation types out of domain model.
- Test runtime packaging in Docker.
- Do dependency tree check for `javax`/`jakarta` conflicts.

## 33.2 Anti-pattern: byte array for every attachment

Causes heap pressure.

## 33.3 Anti-pattern: trust extension as MIME truth

Security risk.

## 33.4 Anti-pattern: use user filename as server path

Path traversal risk.

## 33.5 Anti-pattern: URLDataSource from request parameter

SSRF risk.

## 33.6 Anti-pattern: delete temp file before async send

Read failure.

## 33.7 Anti-pattern: domain model contains DataHandler

Leaks integration concern.

## 33.8 Anti-pattern: global MIME map surprise

Can affect unrelated libraries.

---

# 34. Checklist Review

## 34.1 Dependency

- [ ] `jakarta.activation-api` available?
- [ ] Implementation available if needed?
- [ ] No `javax.activation` conflict?
- [ ] Jakarta Mail/SOAP stack aligned?
- [ ] Docker image includes dependency?
- [ ] EE 11 platform/runtime behavior known?

## 34.2 DataSource design

- [ ] Fresh stream per `getInputStream()`?
- [ ] Correct content type?
- [ ] Safe name?
- [ ] Size known elsewhere?
- [ ] Read-only/write behavior documented?
- [ ] Stream closed by caller?

## 34.3 Attachment security

- [ ] Filename sanitized?
- [ ] Content type allowlisted?
- [ ] Magic bytes/content validated?
- [ ] Size limit enforced?
- [ ] Malware scan?
- [ ] No SSRF?
- [ ] No path traversal?

## 34.4 Performance

- [ ] No large byte arrays?
- [ ] File/object storage streaming?
- [ ] Concurrency limited?
- [ ] Temp file cleanup?
- [ ] Large content tested?

## 34.5 Operations

- [ ] Metadata logged?
- [ ] Content not logged?
- [ ] Checksum available?
- [ ] Failure runbook?
- [ ] Cleanup monitored?

---

# 35. Case Study 1: Email Attachment dengan Jakarta Mail

## 35.1 Requirement

Send monthly PDF report by email.

## 35.2 Bad approach

```java
byte[] pdf = reportService.generateHugePdf();
```

Then attach byte array.

Large heap usage.

## 35.3 Better approach

```text
generate PDF to temp/object storage
  ↓ validate size/type
  ↓ FileDataSource or custom streaming DataSource
  ↓ DataHandler
  ↓ MimeBodyPart
  ↓ send
  ↓ cleanup according to lifecycle
```

## 35.4 Code sketch

```java
MimeBodyPart attachment = new MimeBodyPart();
DataSource source = new FileDataSource(reportFile);
attachment.setDataHandler(new DataHandler(source));
attachment.setFileName("monthly-report.pdf");
```

## 35.5 Add security

- generated filename controlled;
- `application/pdf`;
- max size;
- audit hash.

## 35.6 Lesson

Activation gives the transport abstraction; you still own lifecycle and safety.

---

# 36. Case Study 2: SOAP Attachment dengan `DataHandler`

## 36.1 Requirement

Send document to legacy SOAP partner.

## 36.2 Design

```text
Document stored in object storage
  ↓ ObjectStorageDataSource
  ↓ DataHandler
  ↓ SOAP AttachmentPart or MTOM payload
```

## 36.3 Code concept

```java
DataHandler handler = new DataHandler(documentDataSource);
AttachmentPart part = soapMessage.createAttachmentPart(handler);
part.setContentId("<doc-123>");
soapMessage.addAttachmentPart(part);
```

## 36.4 Interop checks

- content ID format;
- content type;
- attachment mechanism;
- SOAP version;
- partner max size.

## 36.5 Lesson

DataHandler is common currency for binary content in SOAP stacks.

---

# 37. Case Study 3: MIME Type Salah dan Partner Menolak File

## 37.1 Problem

App sends CSV as:

```text
application/octet-stream
```

Partner expects:

```text
text/csv; charset=UTF-8
```

Partner rejects file.

## 37.2 Root cause

MIME type guessed from unknown extension or default map fallback.

## 37.3 Fix

Set content type explicitly from contract:

```java
"text/csv; charset=UTF-8"
```

Use custom DataSource.

## 37.4 Test

Golden MIME message/attachment headers.

## 37.5 Lesson

For contracts, MIME type is not best-effort. It is part of API.

---

# 38. Case Study 4: Attachment Besar Membuat Heap Naik

## 38.1 Problem

High concurrency sends 50 MB attachments using byte arrays.

```text
100 concurrent × 50 MB = 5 GB heap pressure
```

## 38.2 Fix

Use file/object-storage-backed DataSource.

Limit concurrency.

Avoid `getContent()`.

Stream.

## 38.3 Add monitoring

Track attachment bytes in progress.

## 38.4 Cleanup

Ensure temp files are deleted after send success/failure.

## 38.5 Lesson

Data abstraction does not eliminate physics of bytes.

---

# 39. Latihan Bertahap

## Latihan 1 — FileDataSource

Wrap a local file and print name/content type.

## Latihan 2 — DataHandler

Write DataHandler content to output stream.

## Latihan 3 — ByteArrayDataSource

Implement custom in-memory DataSource.

## Latihan 4 — Multiple read test

Call `getInputStream()` twice and compare bytes.

## Latihan 5 — Custom MIME map

Add custom extension mapping.

## Latihan 6 — Mail attachment

Create MIME email with attachment using Jakarta Mail.

## Latihan 7 — SOAP attachment

Create SAAJ `AttachmentPart` from DataHandler.

## Latihan 8 — Security filename

Sanitize malicious filenames.

## Latihan 9 — Large file

Send/stream large file without byte array.

## Latihan 10 — Migration

Convert `javax.activation` sample to `jakarta.activation`.

---

# 40. Mini Project: Jakarta Activation Content Handling Lab

## 40.1 Goal

Create:

```text
jakarta-activation-content-lab/
```

## 40.2 Modules

```text
file-datasource/
bytearray-datasource/
streaming-datasource/
mime-type-map/
mail-attachment/
soap-attachment/
filename-sanitization/
large-content/
migration-javax-to-jakarta/
runtime-packaging/
```

## 40.3 Deliverables

```text
README.md
ACTIVATION-MENTAL-MODEL.md
DATASOURCE.md
DATAHANDLER.md
MIME-TYPES.md
MAIL-INTEGRATION.md
SOAP-INTEGRATION.md
SECURITY.md
PERFORMANCE.md
FAILURE-MODES.md
```

## 40.4 Required experiments

1. Wrap file with FileDataSource.
2. Implement custom DataSource.
3. Test repeatable streams.
4. Customize MIME type map.
5. Attach file to email.
6. Attach file to SOAP message.
7. Reject path traversal filename.
8. Avoid byte array for large file.
9. Detect javax/jakarta conflict.
10. Run packaged app in Docker/container.

## 40.5 Evaluation questions

1. What is DataSource?
2. What is DataHandler?
3. Why is MIME type important?
4. What is FileTypeMap?
5. Why can extension-based detection be unsafe?
6. Why must DataSource return fresh stream?
7. Why avoid ByteArrayDataSource for large files?
8. How does Jakarta Mail use Activation?
9. How does SAAJ use Activation?
10. What breaks during `javax.activation` → `jakarta.activation` migration?

---

# 41. Referensi Resmi

Referensi utama:

1. Jakarta Activation 2.1  
   https://jakarta.ee/specifications/activation/2.1/

2. Jakarta Activation 2.1 Specification  
   https://jakarta.ee/specifications/activation/2.1/jakarta-activation-spec-2.1

3. Jakarta Activation Specification Overview  
   https://jakarta.ee/specifications/activation/

4. Jakarta Activation API Project  
   https://jakartaee.github.io/jaf-api/

5. Jakarta Activation GitHub Project  
   https://github.com/jakartaee/jaf-api

6. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

7. Jakarta Mail 2.1  
   https://jakarta.ee/specifications/mail/2.1/

8. Jakarta SOAP with Attachments 3.0  
   https://jakarta.ee/specifications/soap-attachments/3.0/

9. Jakarta XML Web Services 4.0  
   https://jakarta.ee/specifications/xml-web-services/4.0/

10. Maven Central — `jakarta.activation-api`  
    https://repo1.maven.org/maven2/jakarta/activation/jakarta.activation-api/

---

# Penutup

Jakarta Activation adalah abstraction layer untuk arbitrary data content.

Mental model ringkas:

```text
DataSource:
  stream + content type + name

DataHandler:
  higher-level wrapper around content

FileTypeMap:
  filename → MIME type

CommandMap:
  MIME type → available commands/handlers

DataContentHandler:
  object/content conversion for MIME type
```

Ia paling sering terasa melalui:

```text
Jakarta Mail attachments
SOAP/SAAJ attachments
MTOM binary content
MIME processing
```

Konteks modern:

```text
Jakarta Activation 2.1 adalah release Jakarta EE 10.
Jakarta EE 11 Platform tetap mencantumkan Activation 2.1.
Jakarta Activation 2.2 sedang dikembangkan untuk Jakarta EE 12.
```

Prinsip paling penting:

```text
Activation describes and exposes content.
It does not validate, secure, store, or govern that content for you.
```

Engineer top-tier tahu bahwa attachment bukan cuma `byte[]`. Ia memikirkan MIME type, filename safety, stream repeatability, memory, temp file lifecycle, malware scanning, content sniffing, Jakarta/Javax mismatch, Docker runtime packaging, dan bagaimana Jakarta Mail/SOAP menggunakan `DataHandler` sebagai common content abstraction.

Bagian berikutnya akan membahas **Jakarta Deployment (`jakarta.enterprise.deploy`)**: deployment SPI, deployer/container contract, TargetModuleID, ProgressObject, application server tooling, why it is mostly vendor/tooling-level, and how modern cloud-native deployment differs from classic Jakarta Deployment.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-033.md](./learn-java-jakarta-part-033.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-035.md](./learn-java-jakarta-part-035.md)
