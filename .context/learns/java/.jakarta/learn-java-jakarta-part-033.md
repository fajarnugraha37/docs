# learn-java-jakarta-part-033.md

# Bagian 33 — Jakarta SOAP with Attachments (`jakarta.xml.soap`) / SAAJ: SOAP Message Object Model, Header, Body, Fault, Attachments, dan Low-Level SOAP Processing

> Target pembaca: Java engineer yang ingin memahami Jakarta SOAP with Attachments / SAAJ bukan sekadar “API XML lama”, tetapi sebagai **low-level SOAP message API**: membuat, membaca, memodifikasi, mengirim, dan menerima SOAP message beserta MIME attachments. Materi ini penting untuk debugging SOAP, custom gateway, handler, interoperability, MTOM/attachment boundary, dan migrasi legacy SOAP stack.
>
> Fokus bagian ini: Jakarta SOAP with Attachments 3.0, statusnya sebagai standalone spec yang **di-remove dari Jakarta EE 11 Platform**, `SOAPMessage`, `SOAPPart`, `SOAPEnvelope`, `SOAPHeader`, `SOAPBody`, `SOAPFault`, `SOAPElement`, `SOAPFactory`, `MessageFactory`, `AttachmentPart`, `MimeHeaders`, `SOAPConnection`, SOAP 1.1 vs 1.2, SOAP with Attachments, SAAJ vs JAX-WS, XML security, attachment streaming, memory risks, handler/gateway use cases, and production-grade SOAP message handling.

---

## Daftar Isi

1. [Orientasi: SAAJ Itu Apa dan Kenapa Masih Relevan?](#1-orientasi-saaj-itu-apa-dan-kenapa-masih-relevan)
2. [Status Modern: Jakarta SOAP with Attachments 3.0 dan Jakarta EE 11](#2-status-modern-jakarta-soap-with-attachments-30-dan-jakarta-ee-11)
3. [Mental Model: SOAP Message sebagai XML Envelope + Optional MIME Attachments](#3-mental-model-soap-message-sebagai-xml-envelope--optional-mime-attachments)
4. [SAAJ vs JAX-WS vs JAXB vs DOM/StAX](#4-saaj-vs-jax-ws-vs-jaxb-vs-domstax)
5. [Dependency, Runtime, API, dan Implementation](#5-dependency-runtime-api-dan-implementation)
6. [Peta API `jakarta.xml.soap`](#6-peta-api-jakartaxmlsoap)
7. [`MessageFactory`: Membuat `SOAPMessage`](#7-messagefactory-membuat-soapmessage)
8. [`SOAPMessage`: Root Object untuk SOAP + Attachments](#8-soapmessage-root-object-untuk-soap--attachments)
9. [`SOAPPart`: XML SOAP Part](#9-soappart-xml-soap-part)
10. [`SOAPEnvelope`: Container Header dan Body](#10-soapenvelope-container-header-dan-body)
11. [`SOAPHeader`: Metadata, Routing, Security, Correlation](#11-soapheader-metadata-routing-security-correlation)
12. [`SOAPBody`: Payload dan Operation Data](#12-soapbody-payload-dan-operation-data)
13. [`SOAPFault`: Standardized SOAP Error](#13-soapfault-standardized-soap-error)
14. [`SOAPElement`: Building Block Tree SOAP](#14-soapelement-building-block-tree-soap)
15. [`Name` vs `QName`](#15-name-vs-qname)
16. [`SOAPFactory`: Membuat Element, Detail, Fault](#16-soapfactory-membuat-element-detail-fault)
17. [`MimeHeaders`: HTTP/MIME Metadata](#17-mimeheaders-httpmime-metadata)
18. [`AttachmentPart`: MIME Attachments](#18-attachmentpart-mime-attachments)
19. [SOAP with Attachments vs MTOM](#19-soap-with-attachments-vs-mtom)
20. [`SOAPConnection`: Simple Request/Response Client](#20-soapconnection-simple-requestresponse-client)
21. [SOAP 1.1 vs SOAP 1.2](#21-soap-11-vs-soap-12)
22. [Building SOAP Request Manual](#22-building-soap-request-manual)
23. [Parsing dan Reading SOAP Response](#23-parsing-dan-reading-soap-response)
24. [Modifying SOAP Messages in Handler/Gateway](#24-modifying-soap-messages-in-handlergateway)
25. [SAAJ dalam JAX-WS Handler](#25-saaj-dalam-jax-ws-handler)
26. [When to Use SAAJ Directly](#26-when-to-use-saaj-directly)
27. [When Not to Use SAAJ Directly](#27-when-not-to-use-saaj-directly)
28. [Security: TLS, SOAP Header, WS-Security, dan Jangan Hand-Roll Crypto](#28-security-tls-soap-header-ws-security-dan-jangan-hand-roll-crypto)
29. [XML Security: XXE, Entity Expansion, External References](#29-xml-security-xxe-entity-expansion-external-references)
30. [Attachment Security: Size, Type, Malware, Path Traversal](#30-attachment-security-size-type-malware-path-traversal)
31. [Performance Engineering dan Memory Model](#31-performance-engineering-dan-memory-model)
32. [Thread Safety dan Object Lifecycle](#32-thread-safety-dan-object-lifecycle)
33. [Observability: Logging SOAP Safely](#33-observability-logging-soap-safely)
34. [Testing Strategy](#34-testing-strategy)
35. [Migration: `javax.xml.soap` → `jakarta.xml.soap`](#35-migration-javaxxmlsoap--jakartaxmlsoap)
36. [Java 11+ dan SAAJ Tidak Lagi dari JDK](#36-java-11-dan-saaj-tidak-lagi-dari-jdk)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices dan Anti-Patterns](#38-best-practices-dan-anti-patterns)
39. [Checklist Review](#39-checklist-review)
40. [Case Study 1: Inject Correlation ID ke SOAP Header](#40-case-study-1-inject-correlation-id-ke-soap-header)
41. [Case Study 2: Consume Legacy SOAP Endpoint tanpa Generated Stub](#41-case-study-2-consume-legacy-soap-endpoint-tanpa-generated-stub)
42. [Case Study 3: Attachment Besar Membuat Heap Meledak](#42-case-study-3-attachment-besar-membuat-heap-meledak)
43. [Case Study 4: SOAP Fault Parsing untuk Partner Error Handling](#43-case-study-4-soap-fault-parsing-untuk-partner-error-handling)
44. [Latihan Bertahap](#44-latihan-bertahap)
45. [Mini Project: Jakarta SOAP with Attachments Lab](#45-mini-project-jakarta-soap-with-attachments-lab)
46. [Referensi Resmi](#46-referensi-resmi)

---

# 1. Orientasi: SAAJ Itu Apa dan Kenapa Masih Relevan?

Jakarta SOAP with Attachments adalah spesifikasi API untuk membuat dan mengonsumsi SOAP messages yang sesuai dengan:

- SOAP 1.1;
- SOAP 1.2;
- SOAP Attachments Feature.

Nama historisnya adalah:

```text
SAAJ — SOAP with Attachments API for Java
```

Package modern:

```java
jakarta.xml.soap
```

Package lama:

```java
javax.xml.soap
```

## 1.1 SAAJ adalah low-level API

Jika JAX-WS adalah high-level framework:

```text
Java method call ↔ SOAP service
```

SAAJ adalah low-level message API:

```text
create SOAP envelope
add header
add body element
add attachment
send/read SOAP message
```

## 1.2 Kenapa masih penting?

Walau jarang dipakai langsung dalam aplikasi baru, SAAJ penting untuk:

- debugging SOAP envelope;
- custom SOAP handler;
- SOAP gateway/proxy;
- legacy endpoint tanpa WSDL yang usable;
- manual SOAP request ke service lama;
- reading/writing SOAP headers;
- manipulating attachments;
- interoperability issue dengan partner;
- test tooling;
- migration dari legacy `javax.xml.soap`.

## 1.3 SAAJ bukan replacement JAX-WS

Jika kamu punya WSDL yang baik dan service contract stabil, biasanya gunakan JAX-WS.

Gunakan SAAJ langsung jika kamu butuh kontrol message-level.

## 1.4 Analogi

JAX-WS seperti ORM untuk SOAP operations.

SAAJ seperti DOM API untuk SOAP envelope.

## 1.5 Prinsip utama

```text
Use SAAJ when you need SOAP message-level control.
Use JAX-WS when you need typed service operations.
```

---

# 2. Status Modern: Jakarta SOAP with Attachments 3.0 dan Jakarta EE 11

Jakarta SOAP with Attachments 3.0 adalah release untuk Jakarta EE 10.

Jakarta EE 11 menghapus Jakarta SOAP with Attachments dari Platform.

Artinya:

```text
Jakarta EE 11 runtime tidak wajib menyediakan jakarta.xml.soap.
```

Jika aplikasi modern tetap membutuhkan SAAJ, tambahkan dependency dan implementation secara eksplisit.

## 2.1 Standalone spec

Dihapus dari Platform bukan berarti tidak bisa digunakan.

Ia tetap tersedia sebagai standalone Jakarta specification.

## 2.2 Hubungan dengan XML Web Services

Jakarta XML Web Services dibangun di atas Jakarta SOAP with Attachments dan Jakarta Web Services Metadata.

Ketika XML Web Services dihapus dari Jakarta EE 11 Platform, SOAP with Attachments juga ikut tidak lagi menjadi bagian Platform.

## 2.3 Java SE baseline historis

Spec page menyebut minimum Java SE 8 atau lebih tinggi untuk Jakarta SOAP with Attachments 3.0.

Namun jika kamu memakai Jakarta EE 11 atau Java 21, dependency/runtime tetap harus selaras.

## 2.4 Practical impact

Di Java 21 + Jakarta EE 11:

```text
import jakarta.xml.soap.*
```

tidak akan otomatis tersedia kecuali kamu menambahkan API + implementation.

## 2.5 Project baru

Untuk greenfield service API, jangan memilih SAAJ/JAX-WS kecuali SOAP interoperability memang required.

---

# 3. Mental Model: SOAP Message sebagai XML Envelope + Optional MIME Attachments

SOAP message terdiri dari:

```text
SOAPMessage
  ├── SOAPPart
  │   └── SOAPEnvelope
  │       ├── SOAPHeader
  │       └── SOAPBody
  └── AttachmentPart*
```

## 3.1 SOAPPart

Bagian XML utama dari SOAP message.

## 3.2 SOAPEnvelope

Root XML envelope.

## 3.3 SOAPHeader

Metadata opsional:

- auth/security;
- correlation;
- routing;
- WS-Addressing;
- partner-specific header.

## 3.4 SOAPBody

Payload operation atau fault.

## 3.5 AttachmentPart

MIME attachments.

Attachment tidak harus XML.

Bisa berupa:

- PDF;
- image;
- text;
- binary file;
- XML document terpisah;
- any MIME typed content.

## 3.6 Message-level view

SAAJ melihat SOAP sebagai message, bukan Java service method.

## 3.7 Why this matters

Jika masalahmu ada di XML envelope/header/attachment, SAAJ memberi akses langsung.

Jika masalahmu sekadar call operation, JAX-WS lebih tinggi levelnya.

---

# 4. SAAJ vs JAX-WS vs JAXB vs DOM/StAX

## 4.1 SAAJ / Jakarta SOAP with Attachments

Low-level SOAP message object model.

## 4.2 JAX-WS / Jakarta XML Web Services

High-level SOAP service/client framework.

Uses SAAJ underneath for SOAP message handling.

## 4.3 JAXB / Jakarta XML Binding

Object-XML mapping for payloads.

## 4.4 DOM

Generic XML tree API.

Can manipulate XML but not SOAP-specific semantics.

## 4.5 StAX

Streaming XML API.

Good for large XML.

## 4.6 Decision table

| Need | Prefer |
|---|---|
| Call SOAP operation from WSDL | JAX-WS client |
| Implement typed SOAP endpoint | JAX-WS endpoint |
| Read/add SOAP header manually | SAAJ or JAX-WS SOAPHandler |
| Build raw SOAP envelope | SAAJ |
| Parse huge XML payload streaming | StAX |
| Map payload XML to Java object | JAXB |
| Send SOAP with attachments manually | SAAJ |
| Low-level SOAP gateway/proxy | SAAJ/Provider |
| New JSON API | Jakarta REST |

## 4.7 Layering

Typical SOAP stack:

```text
JAX-WS
  uses JAXB for payload
  uses SAAJ/SOAP APIs for message model
  uses HTTP transport underneath
```

---

# 5. Dependency, Runtime, API, dan Implementation

## 5.1 API dependency

Example:

```xml
<dependency>
  <groupId>jakarta.xml.soap</groupId>
  <artifactId>jakarta.xml.soap-api</artifactId>
  <version>3.0.2</version>
</dependency>
```

Use version aligned with implementation.

## 5.2 Implementation dependency

API jar alone is not enough.

Common implementation:

```xml
<dependency>
  <groupId>com.sun.xml.messaging.saaj</groupId>
  <artifactId>saaj-impl</artifactId>
  <version>3.0.x</version>
</dependency>
```

Version may vary.

## 5.3 Activation dependency

Attachments often depend on Jakarta Activation APIs.

Ensure:

```text
jakarta.activation
```

is present if implementation requires it.

## 5.4 Jakarta EE 11 note

Because SAAJ is removed from Platform, do not depend on server providing it unless vendor documentation confirms.

## 5.5 Java 11+ note

Do not assume SAAJ from JDK.

Add explicit dependencies.

## 5.6 Runtime provider lookup

`MessageFactory.newInstance()` and `SOAPFactory.newInstance()` need provider implementation.

If missing, creation fails.

## 5.7 Avoid mixing

Do not mix:

```text
javax.xml.soap-api
jakarta.xml.soap-api
old saaj-impl
new jakarta saaj-impl
```

## 5.8 Align with JAX-WS

If using JAX-WS implementation, it may bring SAAJ implementation transitively.

Still verify versions.

---

# 6. Peta API `jakarta.xml.soap`

Important types:

- `MessageFactory`;
- `SOAPMessage`;
- `SOAPPart`;
- `SOAPEnvelope`;
- `SOAPHeader`;
- `SOAPBody`;
- `SOAPBodyElement`;
- `SOAPHeaderElement`;
- `SOAPFault`;
- `Detail`;
- `DetailEntry`;
- `SOAPElement`;
- `SOAPFactory`;
- `Name`;
- `AttachmentPart`;
- `MimeHeaders`;
- `SOAPConnection`;
- `SOAPConnectionFactory`;
- `SOAPConstants`;
- `SOAPException`.

## 6.1 Factory classes

- `MessageFactory` creates messages.
- `SOAPFactory` creates elements/fault/detail.
- `SOAPConnectionFactory` creates connections.

## 6.2 Message object model

- `SOAPMessage`;
- `SOAPPart`;
- `SOAPEnvelope`;
- `SOAPHeader`;
- `SOAPBody`;
- `SOAPFault`.

## 6.3 Attachment model

- `AttachmentPart`;
- MIME headers;
- content ID/type.

## 6.4 Transport helper

- `SOAPConnection`.

## 6.5 Exceptions

- `SOAPException`.

## 6.6 Constants

`SOAPConstants` includes protocol constants for SOAP 1.1/1.2.

---

# 7. `MessageFactory`: Membuat `SOAPMessage`

`MessageFactory` creates SOAP messages.

## 7.1 Default instance

```java
MessageFactory factory = MessageFactory.newInstance();
SOAPMessage message = factory.createMessage();
```

## 7.2 SOAP 1.1

```java
MessageFactory factory =
    MessageFactory.newInstance(SOAPConstants.SOAP_1_1_PROTOCOL);
```

## 7.3 SOAP 1.2

```java
MessageFactory factory =
    MessageFactory.newInstance(SOAPConstants.SOAP_1_2_PROTOCOL);
```

## 7.4 Dynamic protocol

Some implementations support dynamic protocol for parsing messages.

## 7.5 Create from stream

```java
MimeHeaders headers = new MimeHeaders();
SOAPMessage message = factory.createMessage(headers, inputStream);
```

## 7.6 Provider required

`newInstance()` requires implementation.

Missing implementation causes runtime failure.

## 7.7 Cache?

Factory may be reused if implementation allows, but do not assume expensive objects are thread-safe without docs.

Safe pattern: keep factory creation in component initialization and test concurrency, or create per operation if low volume.

---

# 8. `SOAPMessage`: Root Object untuk SOAP + Attachments

`SOAPMessage` represents complete SOAP message.

## 8.1 Access SOAP part

```java
SOAPPart part = message.getSOAPPart();
```

## 8.2 Access attachments

```java
Iterator<AttachmentPart> attachments = message.getAttachments();
```

## 8.3 Add attachment

```java
AttachmentPart attachment = message.createAttachmentPart();
attachment.setContent("hello", "text/plain");
message.addAttachmentPart(attachment);
```

## 8.4 Save changes

```java
message.saveChanges();
```

## 8.5 Write output

```java
message.writeTo(outputStream);
```

## 8.6 MIME headers

```java
MimeHeaders headers = message.getMimeHeaders();
```

## 8.7 Message property

SAAJ implementations may support message properties.

## 8.8 Memory caution

`SOAPMessage` often implies in-memory representation.

Large messages/attachments need careful runtime support.

## 8.9 Not domain object

`SOAPMessage` is transport/message-level artifact.

Do not pass it deep into domain logic.

---

# 9. `SOAPPart`: XML SOAP Part

`SOAPPart` contains SOAP envelope XML.

## 9.1 Get envelope

```java
SOAPEnvelope envelope = message.getSOAPPart().getEnvelope();
```

## 9.2 SOAPPart as DOM document

`SOAPPart` has DOM-like behavior because SAAJ builds on XML object model.

## 9.3 Content

A `SOAPPart` contains one `SOAPEnvelope`.

## 9.4 Source transformation

SOAPPart can interact with XML transform APIs.

## 9.5 Caution

DOM-like operations can be memory-heavy.

## 9.6 Namespace

Envelope namespace depends SOAP protocol version.

## 9.7 Use sparingly

For payload-only manipulation, prefer JAXB/StAX if possible.

---

# 10. `SOAPEnvelope`: Container Header dan Body

`SOAPEnvelope` contains:

- `SOAPHeader`;
- `SOAPBody`.

The `SOAPBody` is required.

`SOAPHeader` is optional but commonly used.

## 10.1 Access header/body

```java
SOAPEnvelope envelope = message.getSOAPPart().getEnvelope();

SOAPHeader header = envelope.getHeader();
SOAPBody body = envelope.getBody();
```

## 10.2 Add namespace

```java
envelope.addNamespaceDeclaration("cus", "https://example.com/customer");
```

## 10.3 Header can be removed

If not needed:

```java
header.detachNode();
```

## 10.4 Body is required

SOAP message must have body.

## 10.5 SOAP version

Envelope namespace differs between SOAP 1.1 and SOAP 1.2.

## 10.6 Prefix control

Prefix control can matter for interop/signature. Test actual output.

## 10.7 Avoid assuming prefix

Namespace URI matters more than prefix, unless partner/signature is strict.

---

# 11. `SOAPHeader`: Metadata, Routing, Security, Correlation

SOAP header carries metadata.

## 11.1 Add header element

```java
QName qname = new QName(
    "https://example.com/headers",
    "CorrelationId",
    "h"
);

SOAPHeaderElement element = header.addHeaderElement(qname);
element.addTextNode(correlationId);
```

## 11.2 mustUnderstand

```java
element.setMustUnderstand(true);
```

## 11.3 actor/role

SOAP headers can target roles/actors.

SOAP 1.1 uses actor.

SOAP 1.2 uses role.

## 11.4 Use cases

- correlation ID;
- request ID;
- partner ID;
- routing metadata;
- security token;
- WS-Addressing.

## 11.5 Security warning

Do not hand-roll WS-Security.

Use mature libraries/runtime for signature/encryption/timestamp.

## 11.6 Header validation

When receiving, validate required headers.

## 11.7 Redaction

Never log sensitive header values.

---

# 12. `SOAPBody`: Payload dan Operation Data

SOAP body contains operation payload or fault.

## 12.1 Add body element

```java
QName operation = new QName(
    "https://example.com/customer",
    "GetCustomerRequest",
    "cus"
);

SOAPBodyElement bodyElement = body.addBodyElement(operation);
bodyElement.addChildElement("customerId").addTextNode("C001");
```

## 12.2 Payload structure

Payload must match partner WSDL/schema expectation.

## 12.3 Fault

If message is fault, body contains `SOAPFault`.

## 12.4 Extract elements

```java
Iterator<?> children = body.getChildElements();
```

## 12.5 JAXB integration

You can marshal JAXB object into body DOM node or transform source.

For high-level binding, JAX-WS is easier.

## 12.6 Body validation

Do not trust incoming body.

Validate structure/schema when needed.

## 12.7 Namespace correctness

Most SOAP interop bugs are namespace/body element mismatches.

---

# 13. `SOAPFault`: Standardized SOAP Error

SOAP fault represents error.

## 13.1 Add fault

```java
SOAPFault fault = body.addFault();
fault.setFaultString("Invalid request");
fault.setFaultCode(new QName(
    SOAPConstants.URI_NS_SOAP_1_1_ENVELOPE,
    "Client"
));
```

## 13.2 SOAP 1.1 fault

Includes:

- faultcode;
- faultstring;
- faultactor;
- detail.

## 13.3 SOAP 1.2 fault

Includes:

- Code;
- Reason;
- Node;
- Role;
- Detail.

## 13.4 Detail

```java
Detail detail = fault.addDetail();
detail.addDetailEntry(new QName(ns, "errorCode"))
      .addTextNode("INVALID_CUSTOMER_ID");
```

## 13.5 Business fault

Use stable error code/detail.

## 13.6 Do not leak stack trace

Fault string/detail should be safe for partner.

## 13.7 Client parsing

Client can inspect fault code and detail to classify retry/business error.

## 13.8 Version matters

Fault APIs/structure differ SOAP 1.1 vs SOAP 1.2.

---

# 14. `SOAPElement`: Building Block Tree SOAP

`SOAPElement` represents an element in SOAP XML tree.

## 14.1 Add child

```java
SOAPElement customer = bodyElement.addChildElement("customer");
customer.addChildElement("id").addTextNode("C001");
```

## 14.2 Add attribute

```java
customer.addAttribute(new QName("type"), "premium");
```

## 14.3 Namespace child

```java
SOAPElement id = customer.addChildElement("id", "cus");
```

## 14.4 Iterate children

```java
Iterator<?> it = customer.getChildElements();
```

## 14.5 Text node

```java
element.addTextNode("value");
```

## 14.6 DOM-like caution

Manual tree manipulation is verbose and error-prone.

For structured payloads, prefer JAXB/JAX-WS.

## 14.7 Namespace/prefix correctness

Be explicit.

---

# 15. `Name` vs `QName`

SAAJ historically has `Name`.

Modern XML APIs commonly use `QName`.

## 15.1 QName

```java
QName q = new QName(namespaceUri, localPart, prefix);
```

## 15.2 Name

```java
Name name = envelope.createName("Customer", "cus", "https://example.com/customer");
```

## 15.3 Prefer QName where API supports it

Modern code usually prefers `QName`.

## 15.4 Legacy APIs

Some SAAJ methods still use `Name`.

## 15.5 Prefix

Prefix is not identity.

Namespace URI + local name is identity.

## 15.6 Interop

Some partners are prefix-sensitive incorrectly.

Test actual envelope.

---

# 16. `SOAPFactory`: Membuat Element, Detail, Fault

`SOAPFactory` creates SOAP elements independent of a message.

## 16.1 Create factory

```java
SOAPFactory factory = SOAPFactory.newInstance();
```

## 16.2 Create element

```java
SOAPElement element = factory.createElement(
    new QName("https://example.com", "Customer", "ex")
);
```

## 16.3 Create fault

```java
SOAPFault fault = factory.createFault(
    "Invalid request",
    new QName(SOAPConstants.URI_NS_SOAP_1_1_ENVELOPE, "Client")
);
```

## 16.4 Create detail

```java
Detail detail = factory.createDetail();
```

## 16.5 Provider required

Needs implementation.

## 16.6 Use cases

- build reusable SOAP fragments;
- construct faults;
- create elements in handlers.

## 16.7 Caution

Elements may need to be added to correct document/message.

---

# 17. `MimeHeaders`: HTTP/MIME Metadata

`MimeHeaders` stores MIME headers associated with SOAP message.

## 17.1 Add header

```java
MimeHeaders headers = message.getMimeHeaders();
headers.addHeader("SOAPAction", "\"GetCustomer\"");
```

## 17.2 Set content type

Runtime usually manages content type, but headers can be set/read.

## 17.3 Read header

```java
String[] values = headers.getHeader("Content-Type");
```

## 17.4 SOAPAction

SOAP 1.1 services may require exact SOAPAction.

## 17.5 Case sensitivity

HTTP header names are case-insensitive semantically, but APIs may return stored form.

## 17.6 Avoid putting secrets in logs

MIME headers may include auth metadata.

## 17.7 Incoming message

When creating message from input stream, provide `MimeHeaders`.

---

# 18. `AttachmentPart`: MIME Attachments

`AttachmentPart` holds non-SOAP-part content.

## 18.1 Create attachment

```java
AttachmentPart attachment = message.createAttachmentPart();
attachment.setContent("hello", "text/plain");
attachment.setContentId("<note1>");
message.addAttachmentPart(attachment);
```

## 18.2 Binary attachment

```java
DataHandler dataHandler = new DataHandler(dataSource);
AttachmentPart attachment = message.createAttachmentPart(dataHandler);
attachment.setContentId("<document1>");
message.addAttachmentPart(attachment);
```

## 18.3 Content type

```java
attachment.setContentType("application/pdf");
```

## 18.4 Content ID

Used to reference attachment.

## 18.5 Iterate attachments

```java
Iterator<AttachmentPart> it = message.getAttachments();
```

## 18.6 Remove attachments

```java
message.removeAllAttachments();
```

## 18.7 Memory risk

Attachments may be loaded into memory depending implementation/configuration.

## 18.8 Validate attachments

Never trust:

- file name;
- content type;
- size;
- extension.

## 18.9 Scan/limit

Large/unknown attachments need size limits and malware scanning.

---

# 19. SOAP with Attachments vs MTOM

## 19.1 SOAP with Attachments

Original SOAP attachment mechanism using MIME multipart.

SOAP part plus attachment parts.

## 19.2 MTOM

Message Transmission Optimization Mechanism.

Optimizes binary XML content by serializing it as MIME attachment while preserving XML Infoset.

## 19.3 SAAJ attachment model

SAAJ exposes `AttachmentPart`.

## 19.4 JAX-WS MTOM

High-level API can enable MTOM with `@MTOM` or feature config.

## 19.5 When SAAJ direct?

If manually constructing multipart SOAP or gatewaying messages.

## 19.6 For business endpoints

Prefer JAX-WS MTOM support.

## 19.7 Interop

Partner must support same attachment mechanism.

## 19.8 Large payload

Regardless of mechanism, verify streaming behavior.

---

# 20. `SOAPConnection`: Simple Request/Response Client

`SOAPConnection` sends SOAP messages directly.

## 20.1 Create connection

```java
SOAPConnectionFactory factory = SOAPConnectionFactory.newInstance();
SOAPConnection connection = factory.createConnection();
```

## 20.2 Call

```java
SOAPMessage response = connection.call(request, endpointUrl);
```

## 20.3 Close

```java
connection.close();
```

Jakarta SOAP with Attachments 3.0 changed `SOAPConnection` to implement `AutoCloseable`.

Use try-with-resources if supported by API version:

```java
try (SOAPConnection connection = factory.createConnection()) {
    SOAPMessage response = connection.call(request, endpointUrl);
}
```

## 20.4 Timeout

Jakarta SOAP with Attachments 3.0 added API support related to setting timeouts for `SOAPConnection.call`.

Exact use/provider behavior should be verified with implementation.

## 20.5 Use cases

- simple manual SOAP client;
- testing;
- gateway;
- legacy endpoint no generated stub.

## 20.6 Limitations

- low-level;
- blocking request-response;
- limited transport features;
- less type safety;
- runtime-specific behavior.

## 20.7 Production caution

For robust client, JAX-WS/HTTP client integration may be better.

---

# 21. SOAP 1.1 vs SOAP 1.2

## 21.1 SOAP 1.1 namespace

```text
http://schemas.xmlsoap.org/soap/envelope/
```

## 21.2 SOAP 1.2 namespace

```text
http://www.w3.org/2003/05/soap-envelope
```

## 21.3 MessageFactory protocol

```java
MessageFactory.newInstance(SOAPConstants.SOAP_1_1_PROTOCOL);
MessageFactory.newInstance(SOAPConstants.SOAP_1_2_PROTOCOL);
```

## 21.4 Fault differences

SOAP 1.2 fault structure differs from SOAP 1.1.

## 21.5 Content-Type

SOAP 1.1 commonly uses:

```text
text/xml
```

SOAP 1.2 commonly uses:

```text
application/soap+xml
```

## 21.6 SOAPAction

SOAP 1.1 uses SOAPAction HTTP header.

SOAP 1.2 handles action differently in content type/action parameter.

## 21.7 Partner strictness

Some partners reject if protocol/content type/action mismatch.

## 21.8 Rule

Match WSDL/partner specification exactly.

---

# 22. Building SOAP Request Manual

## 22.1 Example request

```java
MessageFactory messageFactory =
    MessageFactory.newInstance(SOAPConstants.SOAP_1_1_PROTOCOL);

SOAPMessage message = messageFactory.createMessage();

SOAPEnvelope envelope = message.getSOAPPart().getEnvelope();
envelope.addNamespaceDeclaration("cus", "https://example.com/customer");

SOAPHeader header = envelope.getHeader();
QName correlationName = new QName(
    "https://example.com/headers",
    "CorrelationId",
    "h"
);
header.addHeaderElement(correlationName)
      .addTextNode("corr-123");

SOAPBody body = envelope.getBody();
QName requestName = new QName(
    "https://example.com/customer",
    "GetCustomerRequest",
    "cus"
);

SOAPBodyElement request = body.addBodyElement(requestName);
request.addChildElement("customerId", "cus")
       .addTextNode("C001");

message.saveChanges();
message.writeTo(System.out);
```

## 22.2 Things to verify

- SOAP version;
- namespace URI;
- prefix;
- operation element;
- SOAPAction;
- header requirements;
- body order;
- XML escaping.

## 22.3 Use JAXB for complex payload

Manual SAAJ building becomes verbose.

For complex body, marshal JAXB object into SOAP body.

## 22.4 Test with partner sample

Compare generated SOAP with golden envelope.

## 22.5 Avoid string concatenation

Do not build SOAP XML with raw string concat unless controlled/tested.

---

# 23. Parsing dan Reading SOAP Response

## 23.1 Create from stream

```java
MimeHeaders headers = new MimeHeaders();
headers.addHeader("Content-Type", "text/xml");

SOAPMessage response = messageFactory.createMessage(headers, inputStream);
```

## 23.2 Check fault

```java
SOAPBody body = response.getSOAPBody();

if (body.hasFault()) {
    SOAPFault fault = body.getFault();
    String faultString = fault.getFaultString();
}
```

## 23.3 Read body elements

```java
Iterator<?> elements = body.getChildElements();
while (elements.hasNext()) {
    Object next = elements.next();
    if (next instanceof SOAPElement element) {
        ...
    }
}
```

## 23.4 Read header

```java
SOAPHeader header = response.getSOAPHeader();
```

## 23.5 Read attachments

```java
Iterator<AttachmentPart> attachments = response.getAttachments();
```

## 23.6 Use JAXB for payload

Extract body child and unmarshal.

## 23.7 Error handling

Differentiate:

- SOAP fault;
- malformed SOAP;
- transport failure;
- timeout;
- security failure;
- unexpected payload.

---

# 24. Modifying SOAP Messages in Handler/Gateway

SAAJ is often used in middleware.

## 24.1 Gateway pattern

```text
Inbound SOAP
  ↓ read/validate header
  ↓ add correlation
  ↓ route/transform
  ↓ outbound SOAP
```

## 24.2 Handler pattern

In JAX-WS SOAPHandler, you can access `SOAPMessage`.

## 24.3 Add header

Useful for correlation, routing, metadata.

## 24.4 Remove/replace header

Be careful with signed messages. Changing signed XML invalidates signature.

## 24.5 Transform body

Body transformation is risky.

Prefer explicit mapper/proxy contract.

## 24.6 Attachments

Forwarding attachments should preserve content ID/type.

## 24.7 Logging

Log only sanitized metadata.

## 24.8 Idempotency

Gateway should not create duplicate side effects.

---

# 25. SAAJ dalam JAX-WS Handler

JAX-WS SOAPHandler gives message context.

## 25.1 Conceptual handler

```java
public class CorrelationSoapHandler implements SOAPHandler<SOAPMessageContext> {

    @Override
    public boolean handleMessage(SOAPMessageContext context) {
        SOAPMessage message = context.getMessage();
        ...
        return true;
    }

    @Override
    public boolean handleFault(SOAPMessageContext context) {
        ...
        return true;
    }

    @Override
    public Set<QName> getHeaders() {
        return Set.of();
    }

    @Override
    public void close(MessageContext context) {}
}
```

## 25.2 Direction

```java
Boolean outbound =
    (Boolean) context.get(MessageContext.MESSAGE_OUTBOUND_PROPERTY);
```

## 25.3 Use cases

- correlation ID;
- logging;
- custom headers;
- metrics;
- simple validation.

## 25.4 Avoid business logic

Handler is cross-cutting layer.

## 25.5 Fault handler

Handle SOAP fault messages carefully.

## 25.6 Message save

If modifying message:

```java
message.saveChanges();
```

## 25.7 Security warning

Do not modify signed SOAP messages unless you re-sign correctly.

---

# 26. When to Use SAAJ Directly

Use SAAJ directly when:

- you need raw SOAP envelope control;
- WSDL is absent/broken;
- you build SOAP gateway/proxy;
- you need to inspect/manipulate headers;
- you need direct attachment handling;
- you are writing low-level tests;
- you are debugging interop issues;
- JAX-WS abstraction hides needed details;
- partner requires odd legacy SOAP shape.

## 26.1 Example

Legacy endpoint expects custom header and exact SOAPAction but WSDL generator is broken.

SAAJ can manually craft message.

## 26.2 Another example

A gateway receives SOAP from partner, validates header, forwards to internal service.

## 26.3 Another example

Testing SOAP fault body exactness.

## 26.4 Still isolate

Wrap SAAJ usage in integration adapter.

Do not scatter SAAJ across domain code.

---

# 27. When Not to Use SAAJ Directly

Do not use SAAJ directly when:

- WSDL is valid and typed client works;
- you need domain-level service call;
- payload mapping is complex;
- you need WS-Security;
- you need robust retry/timeout/client stack;
- you are building new API without SOAP requirement;
- you want maintainable operation contract.

## 27.1 Use JAX-WS

For standard SOAP service/client.

## 27.2 Use JAXB

For XML payload mapping.

## 27.3 Use REST

For modern JSON APIs.

## 27.4 Use StAX

For huge streaming XML.

## 27.5 Anti-pattern

Manually constructing SOAP strings in business services.

---

# 28. Security: TLS, SOAP Header, WS-Security, dan Jangan Hand-Roll Crypto

## 28.1 Transport security

Use HTTPS/TLS.

For B2B/enterprise, often mTLS.

## 28.2 SOAP header auth

Some legacy services use custom auth header.

Validate carefully.

## 28.3 WS-Security

Includes standards for:

- username token;
- timestamp;
- signature;
- encryption;
- binary security token;
- SAML token.

## 28.4 Do not hand-roll

Do not implement XML Signature/Encryption manually with SAAJ unless you are using mature library correctly.

## 28.5 Signature invalidation

Changing SOAP envelope/header/body after signing invalidates signature.

## 28.6 Redaction

Security headers must not be logged.

## 28.7 Replay protection

Use timestamp/nonce/request ID if protocol requires.

## 28.8 Certificate rotation

Operationally plan:

- keystore;
- truststore;
- partner cert;
- expiry alerts;
- rollover.

---

# 29. XML Security: XXE, Entity Expansion, External References

SAAJ parses XML.

So XML parser security matters.

## 29.1 XXE

Untrusted SOAP can contain DTD/external entity.

## 29.2 XML bomb

Entity expansion can exhaust resources.

## 29.3 External references

Schema or entity access can cause SSRF.

## 29.4 SAAJ parsing

`MessageFactory.createMessage(headers, inputStream)` delegates parsing to implementation.

Verify implementation hardening options.

## 29.5 If using custom parser

Disable DTD/external entities.

## 29.6 Size limits

Set HTTP request size, SOAP body size, attachment size.

## 29.7 Depth limits

Use parser/runtime limits where available.

## 29.8 Test malicious payloads

Add XXE/XML bomb test cases.

## 29.9 Rule

```text
Never parse untrusted SOAP without XML security posture.
```

---

# 30. Attachment Security: Size, Type, Malware, Path Traversal

Attachments are arbitrary MIME content.

## 30.1 Size limit

Set max attachment size.

Reject too large.

## 30.2 Content type

Do not trust content type.

Sniff/validate when needed.

## 30.3 File name

Attachment may have content disposition/name.

Do not use raw filename for filesystem path.

Path traversal risk:

```text
../../etc/passwd
```

## 30.4 Malware scanning

For uploaded documents, scan if required.

## 30.5 Store safely

Use object store/temp storage with random names.

## 30.6 Streaming

Avoid loading entire attachment to heap.

## 30.7 Logging

Never log binary content.

Log metadata:

- content ID;
- content type;
- size;
- hash.

## 30.8 Hash

Compute checksum for audit/dedup.

---

# 31. Performance Engineering dan Memory Model

## 31.1 SOAPMessage can be heavy

It often stores XML tree in memory.

## 31.2 Attachments can be heavy

Implementation may buffer attachments.

## 31.3 Avoid large in-memory SOAP

For huge payloads, consider:

- MTOM streaming;
- JAX-WS configured streaming;
- StAX for XML;
- file-backed temp storage.

## 31.4 Pretty printing

Writing formatted XML adds size/CPU if done manually.

## 31.5 DOM-style traversal

Walking tree repeatedly costs CPU.

## 31.6 Reuse factories carefully

Factory reuse may help; verify thread safety.

## 31.7 Avoid repeated parsing

Do not parse/write SOAP multiple times in pipeline.

## 31.8 Benchmark

Use real partner payloads and attachments.

## 31.9 Backpressure

Limit concurrent SOAP processing if memory-heavy.

---

# 32. Thread Safety dan Object Lifecycle

## 32.1 SOAPMessage

Treat as mutable and not thread-safe.

Do not share across threads.

## 32.2 SOAPElement tree

Mutable.

Confine to request/task.

## 32.3 MessageFactory/SOAPFactory

Thread-safety may depend implementation.

If uncertain, use per-thread/per-operation or test.

## 32.4 SOAPConnection

Use per operation or manage carefully.

Close connections.

## 32.5 Attachment streams

Close streams.

Avoid leaking temp files.

## 32.6 Handler concurrency

SOAPHandler instances may be reused by runtime.

Make handler stateless/thread-safe.

## 32.7 Mutable static state

Avoid in handlers/factories.

---

# 33. Observability: Logging SOAP Safely

## 33.1 What to log

- partner;
- operation/action;
- correlation ID;
- SOAP version;
- endpoint;
- duration;
- fault code;
- status;
- attachment count/size;
- message size.

## 33.2 What not to log

- passwords;
- tokens;
- full PII payload;
- security headers;
- binary attachments;
- private keys/cert secrets.

## 33.3 Sanitized SOAP

In lower environments, raw SOAP logging can help.

In production, use redaction/sampling/secure storage.

## 33.4 Fault logging

Log fault code/reason/detail code, not full sensitive detail.

## 33.5 Attachment hash

For audit:

```text
contentId, size, sha256
```

## 33.6 Correlation

Add/read SOAP header for correlation.

## 33.7 Metrics

- request count;
- parse errors;
- fault count;
- attachment size;
- XML security rejection;
- timeout;
- processing duration.

## 33.8 Trace

If using distributed tracing, propagate trace/correlation through SOAP headers.

---

# 34. Testing Strategy

## 34.1 Golden message tests

Compare generated SOAP envelope to approved sample.

## 34.2 SOAP version tests

Verify SOAP 1.1/1.2 namespace/content type/SOAPAction.

## 34.3 Header tests

Verify required headers present.

## 34.4 Fault tests

Build/parse fault messages.

## 34.5 Attachment tests

Test binary attachments:

- content ID;
- content type;
- size;
- streaming/memory.

## 34.6 Security tests

- XXE;
- XML bomb;
- external entity;
- oversized attachment;
- malicious filename;
- invalid content type.

## 34.7 Interop tests

Send message to mock/partner test endpoint.

## 34.8 Handler tests

Test outbound/inbound handler modifications.

## 34.9 Migration tests

`javax` sample message behavior vs `jakarta` version.

## 34.10 Performance tests

Large SOAP/attachment load tests.

---

# 35. Migration: `javax.xml.soap` → `jakarta.xml.soap`

## 35.1 Package rename

Old:

```java
javax.xml.soap.*
```

New:

```java
jakarta.xml.soap.*
```

## 35.2 Dependency update

Old SAAJ API/impl will not satisfy Jakarta imports.

Use Jakarta-compatible API and implementation.

## 35.3 Related packages

If used with JAX-WS/JAXB:

Old:

```java
javax.xml.ws.*
javax.xml.bind.*
javax.jws.*
```

New:

```java
jakarta.xml.ws.*
jakarta.xml.bind.*
jakarta.jws.*
```

## 35.4 Implementation update

Use SAAJ implementation compatible with `jakarta.xml.soap` 3.x.

## 35.5 Search/replace not enough

Test:

- SOAP 1.1/1.2;
- headers;
- attachments;
- fault creation;
- SOAPConnection;
- handler integration.

## 35.6 Provider lookup

Provider lookup changed over versions.

Ensure runtime implementation discoverable.

## 35.7 Classpath cleanup

Remove old `javax` jars.

## 35.8 Binary compatibility

No binary compatibility between old `javax` and new `jakarta`.

Recompile.

---

# 36. Java 11+ dan SAAJ Tidak Lagi dari JDK

Older Java apps may assume SAAJ from JDK.

Modern Java requires explicit dependencies.

## 36.1 Common error

```text
ClassNotFoundException: javax.xml.soap.MessageFactory
```

or:

```text
ClassNotFoundException: jakarta.xml.soap.MessageFactory
```

depending imports.

## 36.2 Java 8 legacy

Java 8 had many Java EE-related APIs in JDK.

## 36.3 Java 11+

Java EE/CORBA modules removed.

## 36.4 Fix

Add API + implementation dependency.

## 36.5 Modern Jakarta choice

For Jakarta EE 10/11 style apps, use `jakarta.xml.soap`.

## 36.6 Legacy compatibility

If old stack still uses `javax`, either keep old dependencies or migrate all related SOAP stack.

## 36.7 Avoid mixed mode

Do not combine `javax.xml.soap.SOAPMessage` with `jakarta.xml.ws` handler expecting `jakarta.xml.soap.SOAPMessage`.

---

# 37. Production Failure Modes

## 37.1 No provider found

API exists, implementation missing.

`MessageFactory.newInstance()` fails.

## 37.2 SOAP version mismatch

Partner expects SOAP 1.1, client sends SOAP 1.2.

## 37.3 SOAPAction mismatch

Legacy service rejects request.

## 37.4 Namespace mismatch

Body/header element has wrong namespace.

## 37.5 Missing mustUnderstand handling

Required header ignored.

## 37.6 Fault parsing wrong

Client treats business fault as technical error.

## 37.7 Attachment memory spike

Large attachment loaded into heap.

## 37.8 Attachment content type spoofing

Malicious file uploaded.

## 37.9 XXE/XML bomb

Insecure parser processing untrusted SOAP.

## 37.10 Handler corrupts signed message

SOAP signature invalid after modification.

## 37.11 Logs leak secrets

Raw SOAP includes tokens/PII.

## 37.12 Javax/Jakarta mismatch

ClassCastException/import conflicts.

## 37.13 Connection leak

SOAPConnection not closed.

## 37.14 Timeout missing

Blocking call hangs.

---

# 38. Best Practices dan Anti-Patterns

## 38.1 Best practices

- Use JAX-WS for typed operations when possible.
- Use SAAJ only for message-level control.
- Add explicit dependencies on Java 11+/Jakarta EE 11.
- Align `jakarta.xml.soap`, JAX-WS, JAXB, Activation versions.
- Match SOAP version and SOAPAction exactly.
- Use QName/namespace carefully.
- Redact logs.
- Limit attachment size.
- Scan/validate attachments.
- Harden XML parsing.
- Close SOAPConnection/streams.
- Keep handlers stateless/thread-safe.
- Test with golden SOAP messages.
- Avoid modifying signed messages unless re-signing properly.

## 38.2 Anti-pattern: Business logic in SOAPHandler

Handlers are cross-cutting, not domain layer.

## 38.3 Anti-pattern: Raw string SOAP

Manual string concat is fragile and unsafe.

## 38.4 Anti-pattern: Logging full SOAP in production

Leaks secrets/PII.

## 38.5 Anti-pattern: Hand-roll WS-Security

Use established libraries.

## 38.6 Anti-pattern: Load huge attachment to byte array

Use streaming/temp storage.

## 38.7 Anti-pattern: Ignore SOAP version

Interop failure.

## 38.8 Anti-pattern: Mix javax/jakarta

Namespace conflict.

---

# 39. Checklist Review

## 39.1 Dependency/runtime

- [ ] `jakarta.xml.soap-api` present?
- [ ] SAAJ implementation present?
- [ ] Jakarta Activation present if needed?
- [ ] No old `javax` conflict?
- [ ] EE 11 removal accounted for?
- [ ] Provider lookup tested?

## 39.2 SOAP message

- [ ] SOAP 1.1/1.2 correct?
- [ ] Envelope namespace correct?
- [ ] Header namespace correct?
- [ ] Body element correct?
- [ ] SOAPAction correct?
- [ ] Fault format correct?

## 39.3 Attachments

- [ ] Size limit?
- [ ] Content type validation?
- [ ] Malware scan?
- [ ] Streaming/temp storage?
- [ ] Safe filename handling?
- [ ] Hash/audit?

## 39.4 Security

- [ ] TLS/mTLS?
- [ ] XML parser hardened?
- [ ] External entities disabled?
- [ ] WS-Security library used if needed?
- [ ] Logs redacted?
- [ ] Signed messages not modified unexpectedly?

## 39.5 Operations

- [ ] Timeout configured?
- [ ] SOAPConnection closed?
- [ ] Correlation ID propagated?
- [ ] Fault metrics?
- [ ] Golden message tests?
- [ ] Runbook for interop errors?

---

# 40. Case Study 1: Inject Correlation ID ke SOAP Header

## 40.1 Requirement

Every outbound SOAP request to partner must include:

```xml
<h:CorrelationId>...</h:CorrelationId>
```

## 40.2 SAAJ in handler

Use JAX-WS SOAPHandler.

```java
SOAPMessage message = context.getMessage();
SOAPEnvelope envelope = message.getSOAPPart().getEnvelope();
SOAPHeader header = envelope.getHeader();

if (header == null) {
    header = envelope.addHeader();
}

QName qname = new QName("https://example.com/headers", "CorrelationId", "h");
header.addHeaderElement(qname).addTextNode(correlationId);

message.saveChanges();
```

## 40.3 Caution

If message is signed before handler, adding header invalidates signature.

Correct ordering matters.

## 40.4 Observability

Log correlation ID and partner operation.

## 40.5 Lesson

SAAJ is useful for message-level cross-cutting metadata.

---

# 41. Case Study 2: Consume Legacy SOAP Endpoint tanpa Generated Stub

## 41.1 Problem

Legacy endpoint has broken/incomplete WSDL.

But partner provides sample SOAP envelope.

## 41.2 Approach

Use SAAJ manual client.

```text
build SOAPMessage
set SOAPAction
send via SOAPConnection
parse SOAPBody/Fault
```

## 41.3 Risks

- no type safety;
- manual namespace handling;
- brittle contract;
- low-level timeout behavior;
- error parsing manual.

## 41.4 Mitigation

- golden sample tests;
- wrapper integration adapter;
- timeout/circuit breaker;
- sanitized raw message logging in staging;
- strict contract documentation.

## 41.5 Lesson

SAAJ is escape hatch for ugly legacy interop.

---

# 42. Case Study 3: Attachment Besar Membuat Heap Meledak

## 42.1 Problem

Service receives SOAP attachments containing PDF up to 300 MB.

Code calls:

```java
byte[] bytes = attachment.getRawContentBytes();
```

Heap spikes.

## 42.2 Fix

Use streaming API if implementation supports.

Stream to temp/object storage.

Set size limit.

Scan file.

Process asynchronously.

## 42.3 Observability

Log:

```text
contentId
contentType
size
sha256
```

## 42.4 Security

Do not trust filename or content type.

## 42.5 Lesson

Attachment API can hide memory cost. Design for streaming.

---

# 43. Case Study 4: SOAP Fault Parsing untuk Partner Error Handling

## 43.1 Problem

Partner returns SOAP fault.

Client logs generic error and retries all faults.

This duplicates business operation.

## 43.2 Fix

Parse fault:

```java
if (body.hasFault()) {
    SOAPFault fault = body.getFault();
    QName code = fault.getFaultCodeAsQName();
    String reason = fault.getFaultString();
    Detail detail = fault.getDetail();
}
```

Classify:

- validation fault: no retry;
- duplicate request: no retry or treat as success;
- temporary system fault: retry if idempotent;
- auth fault: no retry until credentials fixed.

## 43.3 Metrics

Count fault by code/detail.

## 43.4 Lesson

SOAP fault is part of protocol contract; do not treat all faults equally.

---

# 44. Latihan Bertahap

## Latihan 1 — Create SOAP 1.1 message

Use `MessageFactory` and write envelope to stdout.

## Latihan 2 — Add header

Add correlation ID header.

## Latihan 3 — Add body payload

Create operation request with namespace.

## Latihan 4 — Add fault

Create SOAP fault with detail.

## Latihan 5 — Parse response

Read SOAP from input stream and inspect body/fault.

## Latihan 6 — Add attachment

Attach text/PDF-like content.

## Latihan 7 — SOAPConnection

Send request to mock endpoint.

## Latihan 8 — SOAPHandler

Add outbound header in JAX-WS handler.

## Latihan 9 — XML security

Try XXE payload and ensure blocked/hardened by runtime/parser.

## Latihan 10 — Migration

Convert `javax.xml.soap` sample to `jakarta.xml.soap`.

---

# 45. Mini Project: Jakarta SOAP with Attachments Lab

## 45.1 Goal

Create:

```text
jakarta-soap-attachments-lab/
```

## 45.2 Modules

```text
soap-message-basic/
soap-header-correlation/
soap-body-payload/
soap-fault/
soap-attachments/
soap-connection-client/
jaxws-soaphandler/
soap11-vs-soap12/
security-xxe/
migration-javax-to-jakarta/
```

## 45.3 Deliverables

```text
README.md
SAAJ-MENTAL-MODEL.md
SOAP-MESSAGE-OBJECT-MODEL.md
HEADERS.md
BODY-FAULT.md
ATTACHMENTS.md
SOAPCONNECTION.md
HANDLERS.md
SECURITY.md
FAILURE-MODES.md
```

## 45.4 Required experiments

1. Build SOAP 1.1 message.
2. Build SOAP 1.2 message.
3. Add/read SOAP header.
4. Add/read SOAP body.
5. Create SOAP fault.
6. Add attachment.
7. Send with SOAPConnection.
8. Modify message in handler.
9. Test malicious XML.
10. Migrate Javax sample.

## 45.5 Evaluation questions

1. What is `SOAPMessage`?
2. What is `SOAPPart`?
3. Difference `SOAPHeader` and `SOAPBody`?
4. What is `SOAPFault`?
5. What is `AttachmentPart`?
6. Difference SAAJ and JAX-WS?
7. When use SAAJ directly?
8. Why is SOAPAction important?
9. What security risks exist in SOAP parsing?
10. Why was SAAJ removed from Jakarta EE 11 Platform?

---

# 46. Referensi Resmi

Referensi utama:

1. Jakarta SOAP with Attachments 3.0  
   https://jakarta.ee/specifications/soap-attachments/3.0/

2. Jakarta SOAP with Attachments 3.0 Specification  
   https://jakarta.ee/specifications/soap-attachments/3.0/jakarta-soap-spec-3.0

3. Jakarta SOAP with Attachments API Docs  
   https://jakarta.ee/specifications/soap-attachments/3.0/apidocs/

4. API Docs — package `jakarta.xml.soap`  
   https://jakarta.ee/specifications/soap-attachments/3.0/apidocs/jakarta.xml.soap/jakarta/xml/soap/package-summary

5. API Docs — `SOAPMessage`  
   https://jakarta.ee/specifications/soap-attachments/3.0/apidocs/jakarta.xml.soap/jakarta/xml/soap/soapmessage

6. API Docs — `SOAPEnvelope`  
   https://jakarta.ee/specifications/soap-attachments/3.0/apidocs/jakarta.xml.soap/jakarta/xml/soap/soapenvelope

7. API Docs — `SOAPConnection`  
   https://jakarta.ee/specifications/soap-attachments/3.0/apidocs/jakarta.xml.soap/jakarta/xml/soap/soapconnection

8. Jakarta EE 11 Platform Specification  
   https://jakarta.ee/specifications/platform/11/jakarta-platform-spec-11.0.pdf

9. Jakarta XML Web Services 4.0  
   https://jakarta.ee/specifications/xml-web-services/4.0/

10. Eclipse SAAJ API Project  
    https://github.com/jakartaee/saaj-api

---

# Penutup

Jakarta SOAP with Attachments / SAAJ adalah low-level API untuk membuat dan memanipulasi SOAP messages beserta attachments.

Mental model ringkas:

```text
SOAPMessage
  ├── SOAPPart
  │   └── SOAPEnvelope
  │       ├── SOAPHeader
  │       └── SOAPBody
  │           └── SOAPFault?
  └── AttachmentPart*
```

Gunakan SAAJ saat kamu perlu:

```text
message-level SOAP control
custom header manipulation
attachment handling
gateway/proxy behavior
raw SOAP debugging
legacy SOAP interop without reliable WSDL
```

Jangan gunakan SAAJ untuk menggantikan JAX-WS typed client/server jika WSDL dan high-level stack tersedia.

Konteks modern penting:

```text
Jakarta SOAP with Attachments 3.0 adalah release Jakarta EE 10.
Jakarta EE 11 menghapus SOAP with Attachments dari Platform.
Java 11+ tidak menyediakan SAAJ dari JDK.
```

Jadi dependency/runtime harus eksplisit.

Prinsip paling penting:

```text
SAAJ gives power over the SOAP wire format.
With that power comes namespace, security, memory, and interoperability responsibility.
```

Engineer top-tier tahu bahwa SOAP bukan hanya XML string. Ia memahami envelope/header/body/fault, attachment MIME boundary, SOAP 1.1 vs 1.2, SOAPAction, XML security, WS-Security risk, handler chain, memory cost attachment, dan kapan harus memakai SAAJ langsung versus JAX-WS.

Bagian berikutnya akan membahas **Jakarta Activation (`jakarta.activation`)**: MIME type, `DataHandler`, `DataSource`, command map, file/mail/SOAP attachment integration, streaming binary data, content type handling, and migration from JavaBeans Activation Framework.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-jakarta-part-032.md](./learn-java-jakarta-part-032.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-034.md](./learn-java-jakarta-part-034.md)

</div>