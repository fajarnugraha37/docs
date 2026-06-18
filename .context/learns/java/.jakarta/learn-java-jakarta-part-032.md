# learn-java-jakarta-part-032.md

# Bagian 32 — Jakarta XML Web Services (`jakarta.xml.ws`) / JAX-WS: SOAP, WSDL, Endpoint, Client, Handler, Fault, MTOM, dan Legacy Interoperability

> Target pembaca: Java engineer yang ingin memahami Jakarta XML Web Services / JAX-WS bukan sebagai “teknologi SOAP lama”, tetapi sebagai **contract-driven XML service stack** yang masih banyak hidup di government, banking, insurance, telco, legacy enterprise, B2B integration, dan sistem yang dikunci oleh WSDL/XSD/WS-* standards.
>
> Fokus bagian ini: Jakarta XML Web Services 4.0, statusnya sebagai standalone spec yang **di-remove dari Jakarta EE 11 Platform**, SOAP mental model, WSDL-first vs code-first, service endpoint, client proxy, `Service`, `Dispatch`, `Provider`, JAXB payload binding, Web Services Metadata, SOAP handlers, logical handlers, SOAP faults, MTOM, async invocation, timeout, WS-Security ecosystem, interoperability, migration from `javax.xml.ws` to `jakarta.xml.ws`, Java 11+ removal context, and production-grade SOAP boundary design.

---

## Daftar Isi

1. [Orientasi: Kenapa SOAP/JAX-WS Masih Perlu Dipahami?](#1-orientasi-kenapa-soapjax-ws-masih-perlu-dipahami)
2. [Status Modern: Jakarta XML Web Services 4.0 dan Jakarta EE 11](#2-status-modern-jakarta-xml-web-services-40-dan-jakarta-ee-11)
3. [Mental Model: SOAP Message, WSDL Contract, Endpoint, Client Stub](#3-mental-model-soap-message-wsdl-contract-endpoint-client-stub)
4. [JAX-WS vs JAX-RS/Jakarta REST vs SOAP vs XML Binding](#4-jax-ws-vs-jax-rsjakarta-rest-vs-soap-vs-xml-binding)
5. [Dependency, Runtime, API, dan Implementation](#5-dependency-runtime-api-dan-implementation)
6. [Peta API `jakarta.xml.ws`](#6-peta-api-jakartaxmlws)
7. [Supporting Specs: SOAP with Attachments, Web Services Metadata, XML Binding](#7-supporting-specs-soap-with-attachments-web-services-metadata-xml-binding)
8. [WSDL: Contract sebagai Source of Truth](#8-wsdl-contract-sebagai-source-of-truth)
9. [SOAP Envelope, Header, Body, Fault](#9-soap-envelope-header-body-fault)
10. [Code-First Service Endpoint](#10-code-first-service-endpoint)
11. [WSDL-First Service Development](#11-wsdl-first-service-development)
12. [`@WebService`, `@WebMethod`, `@WebParam`, `@WebResult`](#12-webservice-webmethod-webparam-webresult)
13. [`@SOAPBinding`: Document/Literal/Wrapped vs Bare](#13-soapbinding-documentliteralwrapped-vs-bare)
14. [Publishing Endpoint Standalone dengan `Endpoint`](#14-publishing-endpoint-standalone-dengan-endpoint)
15. [Container-Managed Endpoint di Jakarta Runtime](#15-container-managed-endpoint-di-jakarta-runtime)
16. [Client Proxy dengan `Service`](#16-client-proxy-dengan-service)
17. [`BindingProvider`: Endpoint Address, Timeout, Headers](#17-bindingprovider-endpoint-address-timeout-headers)
18. [`Dispatch`: Dynamic Client di Message/Payload Level](#18-dispatch-dynamic-client-di-messagepayload-level)
19. [`Provider`: Message-Level Endpoint](#19-provider-message-level-endpoint)
20. [JAXB Payload Binding](#20-jaxb-payload-binding)
21. [SOAP Fault dan Exception Mapping](#21-soap-fault-dan-exception-mapping)
22. [Handlers: LogicalHandler dan SOAPHandler](#22-handlers-logicalhandler-dan-soaphandler)
23. [Handler Chain dan Cross-Cutting Concerns](#23-handler-chain-dan-cross-cutting-concerns)
24. [SOAP Headers: Correlation, Auth, Metadata](#24-soap-headers-correlation-auth-metadata)
25. [MTOM dan Attachments](#25-mtom-dan-attachments)
26. [Async Invocation](#26-async-invocation)
27. [Timeout, Retry, Idempotency, dan Circuit Breaker](#27-timeout-retry-idempotency-dan-circuit-breaker)
28. [Security: TLS, WS-Security, XML Signature, XML Encryption](#28-security-tls-ws-security-xml-signature-xml-encryption)
29. [XML Security: XXE, External Entities, XML Bomb](#29-xml-security-xxe-external-entities-xml-bomb)
30. [Interoperability: .NET, Legacy ESB, Government Gateways](#30-interoperability-net-legacy-esb-government-gateways)
31. [Schema/WSDL Versioning](#31-schemawsdl-versioning)
32. [Performance Engineering](#32-performance-engineering)
33. [Observability: SOAP Logging, Redaction, Metrics, Tracing](#33-observability-soap-logging-redaction-metrics-tracing)
34. [Testing Strategy](#34-testing-strategy)
35. [Migration: `javax.xml.ws` → `jakarta.xml.ws`](#35-migration-javaxxmlws--jakartaxmlws)
36. [Java 11+ dan JAX-WS Tidak Lagi Ada di JDK](#36-java-11-dan-jax-ws-tidak-lagi-ada-di-jdk)
37. [Modern Relevance: Kapan SOAP Masih Masuk Akal?](#37-modern-relevance-kapan-soap-masih-masuk-akal)
38. [When to Avoid JAX-WS for New Work](#38-when-to-avoid-jax-ws-for-new-work)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices dan Anti-Patterns](#40-best-practices-dan-anti-patterns)
41. [Checklist Review](#41-checklist-review)
42. [Case Study 1: Consume Government SOAP Service dari Java 21](#42-case-study-1-consume-government-soap-service-dari-java-21)
43. [Case Study 2: WSDL-First Endpoint untuk Partner Banking](#43-case-study-2-wsdl-first-endpoint-untuk-partner-banking)
44. [Case Study 3: SOAP Fault Tidak Konsisten dan Client Gagal Retry](#44-case-study-3-soap-fault-tidak-konsisten-dan-client-gagal-retry)
45. [Case Study 4: MTOM Attachment Besar Membuat Heap Naik](#45-case-study-4-mtom-attachment-besar-membuat-heap-naik)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Jakarta XML Web Services Interop Lab](#47-mini-project-jakarta-xml-web-services-interop-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Kenapa SOAP/JAX-WS Masih Perlu Dipahami?

Di project baru, banyak tim memilih REST/JSON, gRPC, GraphQL, Kafka, atau event-driven integration.

Namun SOAP dan WSDL masih banyak hidup di enterprise.

Terutama di:

- government systems;
- banking;
- insurance;
- telco;
- healthcare;
- B2B integration;
- legacy ESB;
- enterprise middleware;
- cross-organization file/service contracts;
- vendor systems yang sudah mature dan sulit diubah.

Jakarta XML Web Services adalah penerus Jakarta/Java API untuk membuat dan mengonsumsi XML-based web services, khususnya SOAP services.

## 1.1 SOAP bukan sekadar XML over HTTP

SOAP memiliki konsep:

- envelope;
- header;
- body;
- fault;
- binding;
- WSDL;
- schema types;
- SOAPAction;
- MTOM;
- WS-* ecosystem.

Ia lebih contract-heavy dibanding REST.

## 1.2 JAX-WS bukan hanya server API

Jakarta XML Web Services mencakup:

- service endpoint;
- client proxy;
- dynamic dispatch;
- provider endpoint;
- handlers;
- metadata annotations;
- faults;
- async invocation;
- JAXB/XML binding integration.

## 1.3 Kenapa top engineer perlu tahu?

Karena enterprise engineer sering diminta:

```text
"Consume this WSDL."
"Expose SOAP endpoint for partner."
"Fix SOAP fault mapping."
"Add WS-Security header."
"Why does .NET client fail?"
"Why does generated stub break after Java 11 upgrade?"
"Why did Jakarta EE 11 remove this?"
```

## 1.4 Modern stance

JAX-WS/SOAP bukan default untuk greenfield API.

Namun untuk interoperability dengan legacy/regulatory/partner systems, ia tetap penting.

## 1.5 Prinsip utama

```text
Treat SOAP as an external contract boundary.
Generate/bind carefully, secure XML parsing, and isolate it from your domain model.
```

---

# 2. Status Modern: Jakarta XML Web Services 4.0 dan Jakarta EE 11

Jakarta XML Web Services 4.0 adalah release untuk Jakarta EE 10.

Namun Jakarta EE 11 Platform menghapus Jakarta XML Web Services dari platform.

Artinya:

```text
Jakarta EE 11 runtime tidak wajib menyediakan JAX-WS/XML Web Services.
```

Jika kamu butuh JAX-WS di aplikasi Jakarta EE 11, kamu harus:

- menambahkan dependency eksplisit;
- memakai runtime/implementation yang mendukung;
- mengaktifkan feature server jika perlu;
- tidak mengandalkan Jakarta EE Platform API otomatis.

## 2.1 Apa yang dihapus di EE 11?

Jakarta EE 11 menghapus dari Platform:

- Jakarta XML Web Services;
- Jakarta XML Binding;
- Jakarta SOAP with Attachments.

Ini penting karena JAX-WS bergantung pada XML Binding dan SOAP stack.

## 2.2 Standalone spec tetap ada

Dihapus dari platform bukan berarti tidak bisa digunakan.

Ia menjadi standalone/optional technology yang bisa tetap didukung oleh vendor/runtime tertentu.

## 2.3 Jakarta XML Web Services 4.0 scope

Spec ini mendefinisikan means for implementing XML-Based Web Services based on:

- Jakarta SOAP with Attachments;
- Jakarta Web Services Metadata;
- Jakarta XML Binding.

## 2.4 New project implication

Untuk project baru:

```text
REST/JSON should normally be default.
SOAP/JAX-WS should be chosen when contract/interoperability requires it.
```

## 2.5 Migration implication

Jika upgrade ke Jakarta EE 11, SOAP integration harus diaudit secara eksplisit.

---

# 3. Mental Model: SOAP Message, WSDL Contract, Endpoint, Client Stub

Mental model:

```text
WSDL/XSD contract
  ↓ tools generate Java types/stubs
Client proxy
  ↓ marshal Java object to SOAP XML
SOAP request
  ↓ HTTP/SOAP transport
Service endpoint
  ↓ unmarshal SOAP body to Java method params
Business service
  ↓ response object
SOAP response
```

## 3.1 SOAP message

SOAP message is XML envelope.

```xml
<soap:Envelope>
  <soap:Header>
    ...
  </soap:Header>
  <soap:Body>
    ...
  </soap:Body>
</soap:Envelope>
```

## 3.2 WSDL

WSDL describes:

- service;
- ports;
- bindings;
- operations;
- messages;
- XML schemas;
- endpoint address.

## 3.3 Endpoint

Server-side component that receives SOAP request.

## 3.4 Client stub/proxy

Java object that looks like interface call but sends SOAP XML.

## 3.5 Binding

JAX-WS maps operation/method and XML payloads to Java via metadata and JAXB.

## 3.6 Handlers

Interceptors for SOAP/logging/security/header manipulation.

## 3.7 Fault

SOAP fault is standardized error envelope.

## 3.8 Integration boundary

Domain should not depend directly on generated SOAP classes.

Use mapper/anti-corruption layer.

---

# 4. JAX-WS vs JAX-RS/Jakarta REST vs SOAP vs XML Binding

## 4.1 Jakarta XML Web Services

SOAP/XML web service framework.

## 4.2 Jakarta REST

RESTful HTTP resource framework.

Uses JSON/XML/etc representations.

## 4.3 Jakarta XML Binding

Object/XML mapping layer, often used by JAX-WS.

## 4.4 SOAP

Protocol/message envelope and related standards.

## 4.5 Decision table

| Need | Prefer |
|---|---|
| Modern public JSON API | Jakarta REST |
| Browser/mobile API | Jakarta REST/GraphQL |
| Existing WSDL partner contract | Jakarta XML Web Services |
| SOAP with WS-Security | JAX-WS stack + WS-Security runtime |
| Object ↔ XML mapping | Jakarta XML Binding |
| Huge XML file processing | StAX/SAX + JAXB per record |
| Strict enterprise B2B contract | WSDL/XSD/SOAP if required |
| New internal microservice | REST/gRPC/messaging |
| Legacy ESB integration | SOAP/JAX-WS often needed |

## 4.6 SOAP vs REST mindset

SOAP:

```text
operation-centric, contract-first, XML schema, envelope/fault
```

REST:

```text
resource-centric, HTTP semantics, representation, status codes
```

## 4.7 Don't fake REST with SOAP

SOAP over HTTP is not REST just because it uses HTTP.

---

# 5. Dependency, Runtime, API, dan Implementation

## 5.1 API dependency

Example:

```xml
<dependency>
  <groupId>jakarta.xml.ws</groupId>
  <artifactId>jakarta.xml.ws-api</artifactId>
  <version>4.0.3</version>
</dependency>
```

## 5.2 Implementation dependency

API jar alone is not enough.

Common implementation ecosystem:

- Eclipse Metro / JAX-WS RI;
- application server feature support;
- vendor-specific SOAP stack.

Example implementation coordinate may include:

```xml
<dependency>
  <groupId>com.sun.xml.ws</groupId>
  <artifactId>jaxws-rt</artifactId>
  <version>4.0.x</version>
</dependency>
```

Check latest compatible version for your runtime.

## 5.3 Supporting dependencies

You may also need compatible:

- Jakarta XML Binding API/runtime;
- Jakarta SOAP with Attachments API/runtime;
- Jakarta Web Services Metadata API;
- Jakarta Activation;
- StAX/XML parser dependencies;
- WS-Security libraries if needed.

## 5.4 Runtime feature

Some servers require enabling XML WS feature explicitly.

Example concept:

```xml
<feature>xmlWS-4.0</feature>
```

Exact config depends runtime.

## 5.5 Jakarta EE 11 warning

Do not expect SOAP/JAX-WS from platform.

Add and test dependencies explicitly.

## 5.6 Classpath conflict

Common conflicts:

- `javax.xml.ws` vs `jakarta.xml.ws`;
- old JAXB vs new JAXB;
- old SAAJ vs Jakarta SOAP Attachments;
- transitive dependencies pulling old `javax` libraries.

## 5.7 Rule

```text
JAX-WS namespace, JAXB namespace, SAAJ namespace, metadata annotations, and runtime must align.
```

---

# 6. Peta API `jakarta.xml.ws`

Important package:

```java
jakarta.xml.ws
```

Important types:

- `Service`;
- `Endpoint`;
- `BindingProvider`;
- `Dispatch`;
- `Provider`;
- `Binding`;
- `SOAPBinding`;
- `WebServiceFeature`;
- `Holder`;
- `Response`;
- `AsyncHandler`;
- `WebServiceException`;
- `ProtocolException`;
- `SOAPFaultException`;
- `WebEndpoint`;
- `WebServiceClient`;
- `RequestWrapper`;
- `ResponseWrapper`.

Subpackages:

```java
jakarta.xml.ws.handler
jakarta.xml.ws.handler.soap
jakarta.xml.ws.http
jakarta.xml.ws.soap
jakarta.xml.ws.spi
jakarta.xml.ws.wsaddressing
```

## 6.1 `Service`

Client-side factory for proxies and Dispatch.

## 6.2 `Endpoint`

Standalone publishing API.

## 6.3 `BindingProvider`

Client proxy interface for request context and response context.

## 6.4 `Dispatch`

Dynamic invocation API.

## 6.5 `Provider`

Server-side dynamic endpoint API.

## 6.6 `Handler`

Intercept request/response messages.

## 6.7 `SOAPFaultException`

Represents SOAP fault at runtime.

## 6.8 `WebServiceFeature`

Enables features like MTOM, Addressing.

---

# 7. Supporting Specs: SOAP with Attachments, Web Services Metadata, XML Binding

Jakarta XML Web Services is not alone.

It relies on related specs.

## 7.1 Jakarta SOAP with Attachments

Defines API for producing and consuming SOAP 1.1, SOAP 1.2, and SOAP Attachments messages.

Package historically known as SAAJ.

Modern package:

```java
jakarta.xml.soap
```

## 7.2 Jakarta Web Services Metadata

Defines annotations/programming model for web services:

```java
jakarta.jws.WebService
jakarta.jws.WebMethod
jakarta.jws.WebParam
jakarta.jws.WebResult
jakarta.jws.soap.SOAPBinding
```

## 7.3 Jakarta XML Binding

Maps XML payloads to Java objects.

Modern package:

```java
jakarta.xml.bind
```

## 7.4 Why it matters

A JAX-WS service usually involves:

```text
JWS metadata annotations
  ↓
JAX-WS runtime
  ↓
JAXB payload binding
  ↓
SOAP/SAAJ message layer
```

## 7.5 Migration must include all

Migrating only `jakarta.xml.ws` imports is insufficient.

Check all related specs.

---

# 8. WSDL: Contract sebagai Source of Truth

WSDL describes SOAP service contract.

## 8.1 WSDL contains

- `types`;
- `message`;
- `portType`;
- `binding`;
- `service`;
- `port`;
- endpoint address.

## 8.2 `types`

Usually XML Schema definitions.

## 8.3 `portType`

Abstract operations.

## 8.4 `binding`

Concrete protocol/style.

Example SOAP binding.

## 8.5 `service`

Service and endpoint address.

## 8.6 WSDL-first

Use WSDL as source of truth.

Generate Java artifacts.

## 8.7 Code-first

Write Java endpoint and generate WSDL.

## 8.8 Enterprise preference

For partner integration, WSDL-first is often safer.

Because contract is explicit and reviewable.

## 8.9 WSDL versioning

Treat WSDL as public API contract.

Version deliberately.

---

# 9. SOAP Envelope, Header, Body, Fault

## 9.1 Envelope

Root container.

```xml
<soap:Envelope>
...
</soap:Envelope>
```

## 9.2 Header

Optional metadata.

Common:

- security token;
- correlation ID;
- transaction ID;
- routing;
- WS-Addressing;
- partner metadata.

## 9.3 Body

Operation payload.

## 9.4 Fault

Standard error format.

## 9.5 SOAP 1.1 vs 1.2

Different namespaces and fault structures.

Interoperability depends on matching partner expectations.

## 9.6 SOAPAction

SOAP 1.1 often uses HTTP `SOAPAction` header.

Some partners are strict.

## 9.7 Document/literal

Most interoperable style today.

Avoid RPC/encoded for modern interoperability.

---

# 10. Code-First Service Endpoint

Code-first begins from Java class/interface.

## 10.1 Example

```java
import jakarta.jws.WebMethod;
import jakarta.jws.WebService;

@WebService(
    serviceName = "CustomerService",
    portName = "CustomerPort",
    targetNamespace = "https://example.com/customer"
)
public class CustomerEndpoint {

    @WebMethod
    public CustomerResponse getCustomer(CustomerRequest request) {
        ...
    }
}
```

## 10.2 Pros

- fast to build;
- natural for Java team;
- runtime/tool can generate WSDL.

## 10.3 Cons

- WSDL can change with Java refactor;
- generated contract may not be partner-friendly;
- less control over schema;
- can expose internal model accidentally.

## 10.4 When okay

- internal SOAP service;
- controlled consumers;
- prototype;
- migration wrapper.

## 10.5 Avoid domain exposure

Endpoint DTO should be contract-specific.

## 10.6 Generated WSDL review

Always review generated WSDL before sharing.

---

# 11. WSDL-First Service Development

WSDL-first starts with WSDL/XSD.

## 11.1 Flow

```text
contract.wsdl + schema.xsd
  ↓ wsimport/codegen
Java service interface + JAXB classes
  ↓ implement endpoint
```

## 11.2 Pros

- stable external contract;
- interoperability;
- partner review;
- schema control;
- better for regulated systems.

## 11.3 Cons

- generated code;
- toolchain complexity;
- awkward Java model;
- WSDL evolution overhead.

## 11.4 Good use

- government gateway;
- banking partner;
- vendor-mandated WSDL;
- cross-language consumers;
- formal contract.

## 11.5 Don't manually edit generated code

Use binding customization.

## 11.6 Keep contract in version control

WSDL/XSD are source artifacts.

## 11.7 Contract tests

Validate generated service/client against WSDL.

---

# 12. `@WebService`, `@WebMethod`, `@WebParam`, `@WebResult`

These annotations come from Jakarta Web Services Metadata.

## 12.1 `@WebService`

Marks class/interface as web service.

```java
@WebService(
    name = "CustomerPortType",
    serviceName = "CustomerService",
    portName = "CustomerPort",
    targetNamespace = "https://example.com/customer"
)
public class CustomerEndpoint { ... }
```

## 12.2 `@WebMethod`

Exposes method as operation.

```java
@WebMethod(operationName = "GetCustomer")
public CustomerResponse getCustomer(CustomerRequest request) { ... }
```

## 12.3 Exclude method

```java
@WebMethod(exclude = true)
public void internalHelper() {}
```

## 12.4 `@WebParam`

Controls parameter name/mode.

```java
public CustomerResponse getCustomer(
    @WebParam(name = "request") CustomerRequest request
)
```

## 12.5 `@WebResult`

Controls return element name.

```java
@WebResult(name = "response")
public CustomerResponse getCustomer(...) { ... }
```

## 12.6 Why naming matters

Java method/parameter names may not be preserved or may not match WSDL contract.

Be explicit for public services.

## 12.7 Avoid overloaded methods

WSDL operation mapping and Java overload can be confusing.

---

# 13. `@SOAPBinding`: Document/Literal/Wrapped vs Bare

`@SOAPBinding` controls SOAP message style/use/parameter style.

## 13.1 Common modern choice

```java
@SOAPBinding(
    style = SOAPBinding.Style.DOCUMENT,
    use = SOAPBinding.Use.LITERAL,
    parameterStyle = SOAPBinding.ParameterStyle.WRAPPED
)
```

## 13.2 Document/literal

Interoperable and WS-I friendly.

## 13.3 Wrapped

Request/response elements wrap operation parameters.

## 13.4 Bare

Payload maps more directly to single parameter/result.

Can be useful for strict WSDL-first contracts.

## 13.5 RPC

Older style. Avoid unless legacy requires.

## 13.6 Encoded

Avoid. Poor modern interoperability.

## 13.7 Interop rule

Match partner WSDL exactly.

Do not change binding style casually.

---

# 14. Publishing Endpoint Standalone dengan `Endpoint`

`Endpoint` can publish a service outside full container.

## 14.1 Example

```java
Endpoint endpoint = Endpoint.publish(
    "http://localhost:8080/customer",
    new CustomerEndpoint()
);
```

## 14.2 Use cases

- local demo;
- tests;
- standalone utility;
- embedded service.

## 14.3 Not production default

For enterprise deployment, prefer container/runtime-managed service.

## 14.4 Lifecycle

You must stop endpoint:

```java
endpoint.stop();
```

## 14.5 Security

Standalone publish may not have your server security/filter/TLS stack.

## 14.6 Threading/runtime

Implementation provides server infrastructure.

Understand its limits.

---

# 15. Container-Managed Endpoint di Jakarta Runtime

In application server, endpoint lifecycle is managed by runtime.

## 15.1 Deployment

Endpoint class packaged in WAR/EJB module depending runtime.

## 15.2 Injection

Container may support CDI/EJB/resource injection depending integration.

## 15.3 Transactions

Endpoint may call transactional services.

Do not put complex transaction logic directly in endpoint.

## 15.4 Security

Use container security/TLS/auth integration as appropriate.

SOAP message-level security may require WS-Security stack.

## 15.5 WSDL exposure

Runtime may expose `?wsdl`.

Production policy should define whether WSDL is publicly accessible.

## 15.6 Runtime differences

Because JAX-WS is no longer required in Jakarta EE 11 Platform, support varies by vendor.

## 15.7 Feature enablement

Some runtimes require explicit XML Web Services feature.

---

# 16. Client Proxy dengan `Service`

Client proxy lets Java call SOAP operation like method call.

## 16.1 Generated client

Tool generates service class and port interface from WSDL.

```java
CustomerService service = new CustomerService(wsdlUrl);
CustomerPort port = service.getCustomerPort();

CustomerResponse response = port.getCustomer(request);
```

## 16.2 Dynamic service creation

```java
QName serviceName = new QName(ns, "CustomerService");
Service service = Service.create(wsdlUrl, serviceName);

CustomerPort port = service.getPort(CustomerPort.class);
```

## 16.3 Pros

- type-safe;
- natural Java call;
- WSDL-driven.

## 16.4 Cons

- hides network call;
- can block;
- generated classes;
- timeouts/config not obvious.

## 16.5 Always configure timeout

Default timeout may be infinite or too long depending runtime.

## 16.6 Do not call from transaction if slow

Remote SOAP call inside DB transaction can cause lock/resource issues.

## 16.7 Mapping layer

Map generated SOAP DTOs to internal domain DTOs.

---

# 17. `BindingProvider`: Endpoint Address, Timeout, Headers

Client proxy usually implements `BindingProvider`.

## 17.1 Endpoint address override

```java
BindingProvider bp = (BindingProvider) port;
bp.getRequestContext().put(
    BindingProvider.ENDPOINT_ADDRESS_PROPERTY,
    "https://partner.example.com/ws/customer"
);
```

## 17.2 Request context

Holds runtime properties.

## 17.3 Response context

After invocation:

```java
Map<String, Object> responseContext = bp.getResponseContext();
```

## 17.4 Timeout

Timeout property names are implementation-specific in many stacks.

Examples often use vendor keys.

Always verify runtime docs.

## 17.5 HTTP headers

Some runtimes allow setting HTTP request headers via request context.

## 17.6 SOAP headers

Use handler or WS-Security stack for SOAP headers.

## 17.7 Avoid global mutable proxy sharing

RequestContext is mutable.

If shared across threads, headers/timeouts can leak.

Create/configure proxy per logical client or guard usage.

---

# 18. `Dispatch`: Dynamic Client di Message/Payload Level

`Dispatch<T>` is lower-level dynamic invocation.

## 18.1 When to use

- no generated stubs;
- dynamic WSDL;
- message-level control;
- raw SOAP payload;
- gateway/proxy;
- testing.

## 18.2 Modes

Common modes:

- `Service.Mode.MESSAGE`;
- `Service.Mode.PAYLOAD`.

## 18.3 Example concept

```java
Dispatch<SOAPMessage> dispatch =
    service.createDispatch(portName, SOAPMessage.class, Service.Mode.MESSAGE);

SOAPMessage response = dispatch.invoke(requestMessage);
```

## 18.4 Payload mode

Sends body payload, runtime wraps as needed.

## 18.5 Trade-off

More control, less type safety.

## 18.6 Security

Dynamic SOAP processing must still be secure against XML attacks.

## 18.7 Observability

Useful for debugging exact SOAP envelope.

---

# 19. `Provider`: Message-Level Endpoint

`Provider<T>` is server-side dynamic endpoint.

## 19.1 Use cases

- SOAP gateway;
- raw message processing;
- custom XML protocol;
- bridging legacy endpoints;
- payload-level service.

## 19.2 Example concept

```java
@WebServiceProvider(
    serviceName = "RawService",
    portName = "RawPort",
    targetNamespace = "https://example.com/raw"
)
@ServiceMode(Service.Mode.MESSAGE)
public class RawProvider implements Provider<SOAPMessage> {

    @Override
    public SOAPMessage invoke(SOAPMessage request) {
        ...
    }
}
```

## 19.3 Pros

- complete message control;
- useful for proxy/gateway.

## 19.4 Cons

- no type-safe operation mapping;
- manual XML/SOAP handling;
- security/error handling more complex.

## 19.5 Payload provider

Can operate on XML `Source` payload.

## 19.6 Use sparingly

Most business services should use typed endpoint.

---

# 20. JAXB Payload Binding

JAX-WS uses Jakarta XML Binding to map XML payloads to Java objects.

## 20.1 Parameter mapping

SOAP body elements map to method parameters/return values.

## 20.2 Generated classes

WSDL-first tools generate JAXB classes.

## 20.3 Annotations

Generated classes use:

```java
jakarta.xml.bind.annotation.*
```

in Jakarta namespace.

## 20.4 Schema validation

JAX-WS runtime may support schema validation feature/config.

For strict integrations, enable and test.

## 20.5 Domain isolation

Generated JAXB classes are integration DTOs.

Map to internal domain.

## 20.6 Versioning

When WSDL/XSD changes, regenerate and adapt mapper.

## 20.7 Java type pitfalls

XML date/time, decimal, nil, list semantics follow JAXB rules.

Understand XML Binding.

---

# 21. SOAP Fault dan Exception Mapping

SOAP faults represent errors.

## 21.1 Fault structure

SOAP Fault includes:

- code;
- reason/string;
- detail;
- role/node depending version.

## 21.2 Modeled fault

WSDL can define faults.

Generated Java has checked exception representing fault.

## 21.3 Unmodeled fault

Unexpected runtime error becomes generic SOAP fault.

## 21.4 Throwing fault

Endpoint can throw service-specific exception annotated/mapped by JAX-WS tooling.

## 21.5 Client handling

Client catches:

- modeled exception;
- `SOAPFaultException`;
- `WebServiceException`;
- transport exceptions.

## 21.6 Fault design

Do not leak stack traces.

Include stable error code and human-safe message.

## 21.7 Retry semantics

Fault should communicate whether retry is useful.

Example categories:

- validation error: no retry;
- authentication error: no retry until credentials fixed;
- temporary system error: retry possible;
- duplicate request: idempotent success/fault depending contract.

## 21.8 Business error vs technical error

Model business errors as contract faults when partner needs to handle them.

---

# 22. Handlers: LogicalHandler dan SOAPHandler

Handlers intercept request/response.

## 22.1 LogicalHandler

Works on logical message/payload level.

Good for payload-level processing independent of SOAP details.

## 22.2 SOAPHandler

Works on SOAP message level.

Can access SOAP headers/envelope.

## 22.3 Handler direction

Handlers run for inbound and outbound messages.

## 22.4 Handler chain

Configured by annotation or deployment config.

## 22.5 Use cases

- logging;
- correlation ID;
- custom SOAP headers;
- audit;
- metrics;
- simple validation;
- security integration hook.

## 22.6 Do not overuse handlers

Handlers can become hidden global logic.

Keep business logic out.

## 22.7 Error handling

Handlers can stop chain or throw exceptions.

Understand behavior.

---

# 23. Handler Chain dan Cross-Cutting Concerns

## 23.1 Handler chain config

Example concept:

```java
@HandlerChain(file = "handler-chain.xml")
@WebService
public class CustomerEndpoint { ... }
```

## 23.2 XML config

Defines handlers.

## 23.3 Ordering

Handler order matters.

Example:

```text
correlation → security → logging → business
```

or logging after redaction.

## 23.4 Logging handler

Must redact sensitive data.

## 23.5 Metrics handler

Measure duration and status.

## 23.6 Header handler

Add/read correlation ID.

## 23.7 Security handler

For real WS-Security, prefer mature WS-Security library/runtime, not hand-rolled XML signature.

## 23.8 Test handler chain

Handlers can break interoperability.

---

# 24. SOAP Headers: Correlation, Auth, Metadata

SOAP headers carry metadata outside body.

## 24.1 Common headers

- authentication token;
- correlation ID;
- request ID;
- timestamp;
- WS-Addressing;
- routing;
- tenant;
- signature/security info.

## 24.2 Access headers

Use `SOAPHandler` or runtime-specific facilities.

## 24.3 MustUnderstand

SOAP headers can be marked `mustUnderstand`.

If receiver does not understand required header, fault should occur.

## 24.4 Correlation ID

Add to all logs/traces.

## 24.5 Auth header

Do not invent crypto protocol.

Use TLS/WS-Security/standard partner protocol.

## 24.6 Header validation

Validate presence/format/permissions.

## 24.7 Redaction

Never log secrets from headers.

---

# 25. MTOM dan Attachments

MTOM optimizes binary data in SOAP messages.

## 25.1 Problem

Base64 embedding binary inside XML increases size.

## 25.2 MTOM

Message Transmission Optimization Mechanism sends binary as optimized attachment while preserving XML Infoset semantics.

## 25.3 Enable feature

```java
@MTOM
@WebService
public class DocumentEndpoint { ... }
```

or feature/client config.

## 25.4 DataHandler

Attachments often use `jakarta.activation.DataHandler`.

## 25.5 Use cases

- documents;
- images;
- PDFs;
- large binary payloads.

## 25.6 Streaming

Ensure attachment handling streams rather than loads fully in memory.

## 25.7 Limits

Set max attachment size.

## 25.8 Security

Scan/validate attachments.

Do not trust file name/content type.

## 25.9 Observability

Log metadata, not binary content.

---

# 26. Async Invocation

JAX-WS supports asynchronous client invocation patterns.

## 26.1 Polling style

Returns `Response<T>`.

## 26.2 Callback style

Uses `AsyncHandler<T>`.

## 26.3 Example concept

```java
Response<GetCustomerResponse> response =
    port.getCustomerAsync(request);

while (!response.isDone()) {
    ...
}

GetCustomerResponse result = response.get();
```

## 26.4 Callback concept

```java
port.getCustomerAsync(request, res -> {
    try {
        GetCustomerResponse value = res.get();
    } catch (Exception e) {
        ...
    }
});
```

## 26.5 Threading

Async behavior depends runtime executor.

In Jakarta EE apps, ensure managed executor/threading integration if applicable.

## 26.6 Timeout

Still configure timeout.

## 26.7 Backpressure

Async can increase concurrency and overload partner service.

Use bulkhead/rate limit.

---

# 27. Timeout, Retry, Idempotency, dan Circuit Breaker

SOAP calls are remote calls.

Treat them as unreliable.

## 27.1 Timeout

Always set:

- connection timeout;
- read/request timeout;
- overall SLA timeout.

Property names are implementation-specific.

## 27.2 Retry

Retry only transient failures.

Do not retry non-idempotent operation blindly.

## 27.3 Idempotency key

For create/submit operations, include request ID/idempotency key if partner contract supports.

## 27.4 Circuit breaker

Protect your service if partner is down.

## 27.5 Bulkhead

Separate thread pool/connection pool for SOAP partner.

## 27.6 Fallback

Define business fallback:

- queue for later;
- mark pending;
- return partial;
- fail fast.

## 27.7 Error classification

Classify:

- SOAP fault validation;
- SOAP fault business;
- SOAP fault temporary;
- HTTP 5xx;
- timeout;
- network;
- TLS/auth;
- XML parse/security.

## 27.8 Do not hold DB transaction

Avoid remote SOAP call inside long DB transaction.

---

# 28. Security: TLS, WS-Security, XML Signature, XML Encryption

SOAP security can happen at multiple layers.

## 28.1 Transport security

Use HTTPS/TLS.

For enterprise partners, often mutual TLS.

## 28.2 Message security

WS-Security can include:

- UsernameToken;
- Timestamp;
- BinarySecurityToken;
- XML Signature;
- XML Encryption;
- SAML token.

## 28.3 Do not hand-roll WS-Security

Use mature runtime/library.

XML Signature/Encryption are complex and easy to get wrong.

## 28.4 Clock skew

WS-Security timestamp validation needs clock sync.

## 28.5 Certificate management

Manage:

- keystore;
- truststore;
- certificate rotation;
- CRL/OCSP if required;
- partner certificates.

## 28.6 Canonicalization

XML signature depends on canonicalization.

Changing namespace/prefix/format can break signature.

## 28.7 Secret handling

Do not log security headers.

## 28.8 Replay protection

Use timestamp/nonce/message ID.

## 28.9 Authorization

After authentication, still authorize operation.

---

# 29. XML Security: XXE, External Entities, XML Bomb

SOAP is XML.

So XML parser risks apply.

## 29.1 XXE

External entity can read local files or trigger network calls.

## 29.2 XML bomb

Entity expansion can exhaust resources.

## 29.3 External schemas

Do not allow arbitrary schema resolution from incoming XML.

## 29.4 Secure runtime config

JAX-WS implementation may configure XML parsers internally.

Verify hardening options.

## 29.5 Handler-level caution

If handler parses SOAP body manually, configure parser securely.

## 29.6 Size limits

Set request size and attachment size limits.

## 29.7 Depth/complexity limits

Use parser/runtime limits where available.

## 29.8 Test malicious payloads

Add XML security regression tests.

---

# 30. Interoperability: .NET, Legacy ESB, Government Gateways

SOAP is often chosen for interoperability, but interop is not automatic.

## 30.1 Common interop issues

- SOAP 1.1 vs 1.2 mismatch;
- namespace mismatch;
- SOAPAction mismatch;
- document/literal wrapped vs bare;
- date/time timezone;
- decimal precision;
- nil vs missing;
- MTOM support mismatch;
- WS-Security policy differences;
- certificate chain issues;
- WSDL import resolution.

## 30.2 WS-I Basic Profile

Many enterprise SOAP contracts follow WS-I profile for interoperability.

## 30.3 Test with partner tools

Use:

- SoapUI;
- curl with raw envelope;
- vendor client;
- generated stubs from both sides.

## 30.4 Do not rely only on generated Java tests

Cross-platform tests catch interop issues.

## 30.5 Contract freeze

Once partner consumes WSDL, changes are breaking unless versioned.

## 30.6 Timezone

Be explicit.

## 30.7 Logging

Capture sanitized raw SOAP for interop debugging in lower environments.

---

# 31. Schema/WSDL Versioning

## 31.1 Version namespace

Example:

```text
https://example.com/customer/v1
https://example.com/customer/v2
```

## 31.2 Additive changes

Adding optional elements is more compatible.

## 31.3 Breaking changes

- remove element;
- rename element;
- change namespace;
- change type;
- change operation name;
- change fault contract;
- change wrapper style.

## 31.4 Multiple versions

Run v1 and v2 endpoints side by side if needed.

## 31.5 WSDL location

Publish stable WSDL artifacts.

Do not rely on generated WSDL changing silently.

## 31.6 Governance

Contract review, versioning, deprecation timeline.

## 31.7 Golden samples

Maintain request/response examples per version.

## 31.8 Compatibility tests

Generated client from old WSDL should still work for compatible changes.

---

# 32. Performance Engineering

## 32.1 Costs

SOAP stack cost includes:

- XML parse;
- XML validation;
- JAXB marshal/unmarshal;
- handlers;
- WS-Security signature/encryption;
- MTOM/attachments;
- network latency;
- TLS handshake.

## 32.2 Cache generated clients carefully

Service creation can be expensive.

But proxy/request context can be mutable and not thread-safe.

## 32.3 Connection reuse

Ensure HTTP client transport uses connection pooling if runtime supports.

## 32.4 Payload size

XML is verbose.

Compress at HTTP layer if supported and acceptable.

## 32.5 MTOM

Use for binary payloads.

## 32.6 Avoid DOM for huge messages

Streaming is better where possible.

## 32.7 WS-Security overhead

Signature/encryption are CPU-heavy.

Benchmark.

## 32.8 Backpressure

Limit concurrent calls to partner.

## 32.9 Validation cost

Schema validation is valuable but costs CPU.

Use deliberately.

## 32.10 Benchmark with real partner payload

Toy payloads hide bottlenecks.

---

# 33. Observability: SOAP Logging, Redaction, Metrics, Tracing

## 33.1 Metrics

Track:

- request count by operation;
- latency;
- fault count by fault code;
- transport errors;
- timeout count;
- retry count;
- payload size;
- attachment size;
- validation failure;
- security failure;
- partner response status.

## 33.2 Logs

Include:

- operation;
- partner;
- correlation ID;
- request ID;
- endpoint;
- SOAPAction;
- duration;
- fault code;
- error category.

## 33.3 Redaction

Never log:

- passwords;
- tokens;
- certificates/private keys;
- full PII payload;
- security headers.

## 33.4 Raw SOAP logging

Useful in lower environments.

In production, use controlled/sampled/redacted logging.

## 33.5 Distributed tracing

SOAP is not automatically trace-friendly.

Propagate correlation IDs via SOAP header and logs.

## 33.6 Fault observability

Separate:

- business fault;
- validation fault;
- security fault;
- technical fault;
- transport error.

## 33.7 Runbook

For partner issue, support team needs sanitized request/response, endpoint, timestamp, correlation ID, and contract version.

---

# 34. Testing Strategy

## 34.1 Contract tests

Validate WSDL and generated classes.

## 34.2 Golden SOAP messages

Store sample request/response envelopes.

## 34.3 Client tests

Use mock SOAP server.

Verify request envelope.

## 34.4 Server tests

Send SOAP envelope and verify response/fault.

## 34.5 Interop tests

Use SoapUI or partner-provided tool.

## 34.6 Security tests

- invalid certificate;
- expired timestamp;
- invalid signature;
- replay;
- XXE;
- oversized payload.

## 34.7 Fault tests

Verify modeled faults and unmodeled errors.

## 34.8 Timeout/retry tests

Simulate slow/down partner.

## 34.9 MTOM tests

Test large attachment streaming and limits.

## 34.10 Migration tests

Compare old `javax` output with new `jakarta` output where compatibility needed.

---

# 35. Migration: `javax.xml.ws` → `jakarta.xml.ws`

## 35.1 Package rename

Old:

```java
javax.xml.ws.*
javax.jws.*
javax.xml.soap.*
javax.xml.bind.*
```

New:

```java
jakarta.xml.ws.*
jakarta.jws.*
jakarta.xml.soap.*
jakarta.xml.bind.*
```

## 35.2 Dependencies

Old Java EE/JAX-WS dependencies are not compatible with Jakarta namespace.

Use Jakarta-compatible API and runtime.

## 35.3 Generated code

Regenerate stubs from WSDL using Jakarta-compatible tools.

## 35.4 WSDL contract

WSDL does not necessarily change because Java package changes.

But generated Java classes do.

## 35.5 Handler classes

Update imports:

```java
jakarta.xml.ws.handler.*
jakarta.xml.ws.handler.soap.*
```

## 35.6 SOAP classes

Update SAAJ imports:

```java
jakarta.xml.soap.*
```

## 35.7 JAXB classes

Regenerate/update `jakarta.xml.bind.annotation`.

## 35.8 Runtime

Use JAX-WS implementation compatible with Jakarta 4.x.

## 35.9 Test thoroughly

- generated stubs;
- SOAPAction;
- namespace;
- JAXB marshalling;
- handlers;
- faults;
- MTOM;
- WS-Security.

## 35.10 Avoid mixed classpath

`javax` and `jakarta` SOAP stacks together cause confusion.

---

# 36. Java 11+ dan JAX-WS Tidak Lagi Ada di JDK

Older Java 8 apps often depended on JAX-WS/JAXB APIs from the JDK.

Java 11 removed Java EE and CORBA modules from the JDK.

## 36.1 Symptom

After upgrading Java:

```text
package javax.xml.ws does not exist
```

or runtime class not found.

## 36.2 Fix path

Add explicit dependencies or migrate to Jakarta namespace.

## 36.3 Java 21/Jakarta stack

Prefer Jakarta namespace if modernizing Jakarta EE apps.

## 36.4 Don't confuse two migrations

Java 8 → Java 11+ dependency removal is one issue.

Javax → Jakarta namespace migration is another.

## 36.5 Legacy option

Some systems may stay on `javax` API with explicit external dependencies.

But Jakarta EE 10/11 ecosystem expects `jakarta`.

## 36.6 Audit transitive deps

SOAP dependencies often pull JAXB/SAAJ/Activation.

Ensure all are compatible.

---

# 37. Modern Relevance: Kapan SOAP Masih Masuk Akal?

## 37.1 Still makes sense when

- partner requires WSDL;
- WS-Security is mandatory;
- government/banking standard mandates SOAP;
- existing ESB/service contract is SOAP;
- formal schema/fault contract required;
- legacy consumers cannot change;
- compliance process built around WSDL/XSD.

## 37.2 Less ideal when

- new internal service;
- web/mobile frontend;
- simple CRUD API;
- high-throughput low-latency microservice;
- event-driven async workflow;
- no partner requirement.

## 37.3 SOAP as boundary

Keep SOAP at edge.

Internal core can use:

- domain services;
- REST;
- events;
- database;
- command handlers.

## 37.4 Do not rewrite blindly

A stable SOAP integration may be cheaper to harden than rewrite.

## 37.5 Modernization strategy

- isolate generated code;
- add anti-corruption layer;
- improve timeouts/retry/observability;
- add contract tests;
- migrate dependencies;
- expose internal REST wrapper if needed.

---

# 38. When to Avoid JAX-WS for New Work

Avoid JAX-WS for greenfield when:

- no SOAP partner requirement;
- consumers prefer JSON;
- frontend/mobile clients;
- operational team lacks SOAP tooling;
- WS-Security not needed;
- schema-first process too heavy;
- APIs evolve frequently;
- streaming/event patterns needed.

## 38.1 Prefer REST/JSON

For most modern synchronous APIs.

## 38.2 Prefer messaging

For reliable async integration.

## 38.3 Prefer gRPC

For internal high-performance strongly typed RPC.

## 38.4 Prefer file exchange

For batch/regulatory large file flows.

## 38.5 Decision question

```text
Is SOAP required by contract, regulation, partner, or legacy interoperability?
```

If no, choose simpler modern stack.

---

# 39. Production Failure Modes

## 39.1 Missing JAX-WS implementation

API present but runtime fails to create service/endpoint.

## 39.2 Jakarta/Javax mismatch

Generated stubs use old namespace.

## 39.3 WSDL not found

Client cannot load WSDL from classpath/URL.

## 39.4 Endpoint address wrong

Generated WSDL address points to dev URL.

Override via `BindingProvider`.

## 39.5 Timeout missing

Thread hangs on partner call.

## 39.6 SOAPAction mismatch

Partner rejects request.

## 39.7 Namespace mismatch

Payload expected namespace differs.

## 39.8 Fault mapping broken

Client receives generic `SOAPFaultException` instead of modeled fault.

## 39.9 WS-Security failure

Signature/timestamp/cert mismatch.

## 39.10 Attachment memory issue

Large MTOM attachment loaded fully.

## 39.11 Handler leaks sensitive logs

Raw SOAP logs include credentials/PII.

## 39.12 XML parser attack

XXE/XML bomb not mitigated.

## 39.13 Retry duplicates operation

Non-idempotent operation retried without request ID.

## 39.14 Generated code edited manually

Regeneration loses changes.

---

# 40. Best Practices dan Anti-Patterns

## 40.1 Best practices

- Use WSDL-first for external partner contracts.
- Keep SOAP DTOs separate from domain.
- Add explicit dependencies on Jakarta EE 11.
- Align JAX-WS/JAXB/SAAJ/Metadata runtime versions.
- Configure timeouts.
- Use TLS/mTLS and WS-Security when required.
- Use handlers for cross-cutting concerns, not business logic.
- Redact SOAP logs.
- Contract-test with golden envelopes.
- Use MTOM for binary payloads.
- Classify faults and retry only safe cases.
- Keep generated code reproducible.
- Version WSDL/XSD deliberately.

## 40.2 Anti-pattern: SOAP endpoint exposes entity/domain directly

Couples external contract to internal model.

## 40.3 Anti-pattern: no timeout

Remote calls can hang.

## 40.4 Anti-pattern: retry all faults

Can duplicate business transactions.

## 40.5 Anti-pattern: hand-written WS-Security

Use mature libraries.

## 40.6 Anti-pattern: raw SOAP logging in prod

PII/secret leak.

## 40.7 Anti-pattern: changing WSDL casually

Breaks partners.

## 40.8 Anti-pattern: mixing `javax` and `jakarta`

Classpath chaos.

---

# 41. Checklist Review

## 41.1 Contract

- [ ] WSDL source of truth identified?
- [ ] XSD versioned?
- [ ] SOAP version known?
- [ ] Binding style known?
- [ ] WSDL samples/golden messages stored?
- [ ] Breaking change policy defined?

## 41.2 Runtime/dependencies

- [ ] JAX-WS API present?
- [ ] Implementation present?
- [ ] JAXB runtime present?
- [ ] SAAJ runtime present?
- [ ] Metadata annotations aligned?
- [ ] No `javax`/`jakarta` mismatch?
- [ ] EE 11 removal accounted for?

## 41.3 Client

- [ ] Endpoint address configurable?
- [ ] Timeout configured?
- [ ] Retry policy safe?
- [ ] Circuit breaker/bulkhead?
- [ ] Request ID/idempotency?
- [ ] SOAP headers correct?

## 41.4 Server

- [ ] Endpoint DTO separate from domain?
- [ ] Faults modeled?
- [ ] Auth/authz enforced?
- [ ] Schema validation considered?
- [ ] Handlers tested?
- [ ] WSDL exposure policy set?

## 41.5 Security

- [ ] TLS/mTLS?
- [ ] WS-Security if required?
- [ ] XML parser hardening?
- [ ] Attachment limits?
- [ ] Logs redacted?
- [ ] Replay protection?

## 41.6 Observability

- [ ] Correlation ID?
- [ ] Metrics by operation/fault?
- [ ] Sanitized SOAP capture?
- [ ] Partner error categories?
- [ ] Runbook?

---

# 42. Case Study 1: Consume Government SOAP Service dari Java 21

## 42.1 Context

Agency exposes WSDL.

Your app runs Java 21 and Jakarta EE 11.

## 42.2 Problem

No JAX-WS in JDK.

No JAX-WS guaranteed by Jakarta EE 11 platform.

## 42.3 Solution

- add Jakarta XML Web Services API/runtime;
- add JAXB/SAAJ dependencies;
- generate Jakarta stubs from WSDL;
- configure endpoint URL;
- configure timeout;
- add TLS/mTLS;
- add SOAP headers;
- add contract tests.

## 42.4 Architecture

```text
GovernmentSoapClient
  ↓ generated port
  ↓ mapper
Domain service
```

Generated classes stay in integration package.

## 42.5 Operational

Log operation, correlation ID, duration, fault code.

Do not log full payload in prod.

## 42.6 Lesson

Modern Java requires explicit SOAP stack management.

---

# 43. Case Study 2: WSDL-First Endpoint untuk Partner Banking

## 43.1 Requirement

Bank requires exact WSDL/XSD and SOAP 1.1 document/literal wrapped.

## 43.2 Approach

- WSDL/XSD reviewed by both teams;
- generate endpoint interface/classes;
- implement service endpoint;
- add WS-Security;
- test with bank client;
- version contract.

## 43.3 Avoid

Do not code-first and hope generated WSDL matches bank expectation.

## 43.4 Faults

Define modeled faults:

- validation fault;
- authentication fault;
- duplicate request fault;
- system temporary fault.

## 43.5 Idempotency

Use partner request ID.

## 43.6 Lesson

For regulated partner contracts, WSDL-first prevents accidental contract drift.

---

# 44. Case Study 3: SOAP Fault Tidak Konsisten dan Client Gagal Retry

## 44.1 Problem

Service throws generic runtime exceptions.

Clients receive generic SOAP fault.

They cannot distinguish validation vs temporary failure.

## 44.2 Fix

Define modeled faults:

```text
ValidationFault
BusinessFault
TemporarySystemFault
```

Map exceptions intentionally.

## 44.3 Retry policy

Client retries only temporary system faults and transport timeouts if idempotent.

## 44.4 Observability

Metrics by fault type.

## 44.5 Lesson

SOAP fault contract is part of API design.

---

# 45. Case Study 4: MTOM Attachment Besar Membuat Heap Naik

## 45.1 Problem

SOAP service receives PDF attachments up to 500 MB.

Heap usage spikes.

## 45.2 Root cause

Attachment loaded fully in memory.

## 45.3 Fix

- enable MTOM;
- configure streaming attachment handling;
- set max size;
- stream to temp storage/object store;
- scan file;
- process async if needed.

## 45.4 Security

Validate content type and file signature.

## 45.5 Observability

Track attachment size and processing time.

## 45.6 Lesson

MTOM helps, but runtime config decides whether processing is truly streaming.

---

# 46. Latihan Bertahap

## Latihan 1 — Code-first endpoint

Create simple `@WebService` endpoint.

## Latihan 2 — Generate WSDL

Expose or generate WSDL.

Inspect operations/types.

## Latihan 3 — Client proxy

Generate client and call endpoint.

## Latihan 4 — BindingProvider

Override endpoint address and configure timeout.

## Latihan 5 — Fault

Create modeled fault and test client handling.

## Latihan 6 — Handler

Add SOAPHandler for correlation ID.

## Latihan 7 — Dispatch

Send raw SOAP message with `Dispatch<SOAPMessage>`.

## Latihan 8 — Provider

Create `Provider<SOAPMessage>` endpoint.

## Latihan 9 — MTOM

Send binary attachment.

## Latihan 10 — Migration

Convert `javax.xml.ws` sample to `jakarta.xml.ws`.

---

# 47. Mini Project: Jakarta XML Web Services Interop Lab

## 47.1 Goal

Create:

```text
jakarta-xml-web-services-interop-lab/
```

## 47.2 Modules

```text
code-first-service/
wsdl-first-service/
generated-client/
binding-provider-timeout/
soap-handler-correlation/
modeled-faults/
dispatch-client/
provider-endpoint/
mtom-attachments/
migration-javax-to-jakarta/
```

## 47.3 Deliverables

```text
README.md
SOAP-MENTAL-MODEL.md
WSDL-FIRST.md
CODE-FIRST.md
CLIENT-PROXY.md
HANDLERS.md
FAULTS.md
MTOM.md
SECURITY.md
MIGRATION.md
FAILURE-MODES.md
```

## 47.4 Required experiments

1. Publish code-first endpoint.
2. Consume WSDL with generated client.
3. Override endpoint URL.
4. Configure timeout.
5. Add modeled fault.
6. Add SOAP handler.
7. Use `Dispatch`.
8. Use `Provider`.
9. Send MTOM attachment.
10. Migrate `javax` sample to `jakarta`.

## 47.5 Evaluation questions

1. What is WSDL?
2. What is SOAP envelope?
3. Difference code-first and WSDL-first?
4. What does `Service` do?
5. What does `BindingProvider` do?
6. Difference `Dispatch` and proxy client?
7. Difference `Provider` and endpoint class?
8. What is SOAP fault?
9. Why use MTOM?
10. Why was JAX-WS removed from Jakarta EE 11 Platform?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta XML Web Services 4.0  
   https://jakarta.ee/specifications/xml-web-services/4.0/

2. Jakarta XML Web Services 4.0 Specification  
   https://jakarta.ee/specifications/xml-web-services/4.0/jakarta-xml-ws-spec-4.0

3. Jakarta XML Web Services API Docs  
   https://jakarta.ee/specifications/xml-web-services/4.0/apidocs/

4. API Docs — package `jakarta.xml.ws`  
   https://jakarta.ee/specifications/xml-web-services/4.0/apidocs/jakarta.xml.ws/jakarta/xml/ws/package-summary

5. Jakarta SOAP with Attachments 3.0  
   https://jakarta.ee/specifications/soap-attachments/3.0/

6. Jakarta Web Services Metadata 3.0  
   https://jakarta.ee/specifications/web-services-metadata/3.0/

7. Jakarta XML Binding 4.0  
   https://jakarta.ee/specifications/xml-binding/4.0/

8. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

9. Jakarta EE Platform 11 Specification  
   https://jakarta.ee/specifications/platform/11/jakarta-platform-spec-11.0.pdf

10. Eclipse Metro / Jakarta XML Web Services Implementation  
    https://eclipse-ee4j.github.io/metro-jax-ws/

---

# Penutup

Jakarta XML Web Services / JAX-WS adalah stack untuk XML-based web services, terutama SOAP.

Mental model ringkas:

```text
WSDL/XSD:
  contract

JAX-WS endpoint:
  server-side service

JAX-WS client proxy:
  type-safe SOAP client

JAXB:
  Java object ↔ XML payload

SAAJ:
  SOAP message model

Handlers:
  cross-cutting message interception

SOAP Fault:
  contract-level error
```

Konteks modern penting:

```text
Jakarta XML Web Services 4.0 adalah release Jakarta EE 10.
Jakarta EE 11 menghapus XML Web Services dari Platform.
Java 11+ tidak lagi membawa Java EE/JAX-WS modules dari JDK.
```

Jadi gunakan dependency/runtime eksplisit.

Prinsip paling penting:

```text
SOAP/JAX-WS should be treated as an integration boundary, not as your internal architecture style.
```

Gunakan ketika contract/partner/regulatory interoperability membutuhkan SOAP/WSDL.

Untuk project baru tanpa requirement SOAP, REST/JSON, messaging, atau gRPC biasanya lebih sederhana.

Engineer top-tier tidak hanya bisa generate client dari WSDL. Ia tahu WSDL-first vs code-first, document/literal wrapped, JAXB binding, handler chain, SOAP faults, MTOM, WS-Security, timeout/retry/idempotency, namespace mismatch, Javax→Jakarta migration, dan bagaimana menjaga SOAP integration tetap aman, observable, dan maintainable.

Bagian berikutnya akan membahas **Jakarta SOAP with Attachments (`jakarta.xml.soap`) / SAAJ**: SOAP message object model, envelope/header/body/fault manipulation, attachments, MTOM boundary, low-level SOAP processing, security risks, and when to use SAAJ directly versus JAX-WS.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-jakarta-part-031.md](./learn-java-jakarta-part-031.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-033.md](./learn-java-jakarta-part-033.md)

</div>