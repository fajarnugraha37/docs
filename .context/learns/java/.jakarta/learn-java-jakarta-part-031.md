# learn-java-jakarta-part-031.md

# Bagian 31 — Jakarta XML Binding (`jakarta.xml.bind`) / JAXB: Object-XML Mapping, Schema, Marshalling, Security, dan Migration

> Target pembaca: Java engineer yang ingin memahami Jakarta XML Binding / JAXB bukan sekadar `JAXBContext.newInstance(...)`, tetapi sebagai **binding framework** antara Java object model dan XML document model: schema-first, code-first, marshalling, unmarshalling, namespace, adapters, validation, streaming, security, performance, compatibility, dan migrasi dari `javax.xml.bind` ke `jakarta.xml.bind`.
>
> Fokus bagian ini: Jakarta XML Binding 4.0, statusnya sebagai standalone spec yang **di-remove dari Jakarta EE 11 Platform**, `JAXBContext`, `Marshaller`, `Unmarshaller`, `JAXBElement`, annotations, schema generation, `xjc`, `schemagen`, `XmlAdapter`, validation with XSD, namespace handling, XXE prevention, large XML processing, SOAP/XML legacy integration, and production-grade XML boundary design.

---

## Daftar Isi

1. [Orientasi: Kenapa XML Binding Masih Penting?](#1-orientasi-kenapa-xml-binding-masih-penting)
2. [Status Modern: Jakarta XML Binding 4.0 dan Jakarta EE 11](#2-status-modern-jakarta-xml-binding-40-dan-jakarta-ee-11)
3. [Mental Model: XML Tree ↔ Java Object Graph](#3-mental-model-xml-tree--java-object-graph)
4. [XML Binding vs XML Parser vs JSON-B vs SOAP](#4-xml-binding-vs-xml-parser-vs-json-b-vs-soap)
5. [Dependency, Runtime, API, dan Implementation](#5-dependency-runtime-api-dan-implementation)
6. [Peta API `jakarta.xml.bind`](#6-peta-api-jakartaxmlbind)
7. [`JAXBContext`: Binding Runtime Entry Point](#7-jaxbcontext-binding-runtime-entry-point)
8. [`Marshaller`: Java Object → XML](#8-marshaller-java-object--xml)
9. [`Unmarshaller`: XML → Java Object](#9-unmarshaller-xml--java-object)
10. [`JAXB`: Convenience API](#10-jaxb-convenience-api)
11. [Code-First Binding: Java Class sebagai Source of Truth](#11-code-first-binding-java-class-sebagai-source-of-truth)
12. [Schema-First Binding: XSD sebagai Contract](#12-schema-first-binding-xsd-sebagai-contract)
13. [Annotation Model](#13-annotation-model)
14. [`@XmlRootElement`, `@XmlType`, `@XmlElement`, `@XmlAttribute`](#14-xmlrootelement-xmltype-xmlelement-xmlattribute)
15. [`@XmlAccessorType`: Field vs Property Binding](#15-xmlaccessortype-field-vs-property-binding)
16. [Collection, Wrapper, dan Order](#16-collection-wrapper-dan-order)
17. [`JAXBElement`: Ketika Root Element Tidak Langsung Ada](#17-jaxbelement-ketika-root-element-tidak-langsung-ada)
18. [`ObjectFactory` dan `@XmlElementDecl`](#18-objectfactory-dan-xmlelementdecl)
19. [Namespace dan QName](#19-namespace-dan-qname)
20. [Package-Level Metadata: `package-info.java`](#20-package-level-metadata-package-infojava)
21. [`XmlAdapter`: Adaptasi Tipe yang Tidak Natural di XML](#21-xmladapter-adaptasi-tipe-yang-tidak-natural-di-xml)
22. [Date/Time, BigDecimal, Enum, Optional, dan Records](#22-datetime-bigdecimal-enum-optional-dan-records)
23. [Inheritance dan Polymorphism](#23-inheritance-dan-polymorphism)
24. [Nil, Null, Empty Element, dan Optionality](#24-nil-null-empty-element-dan-optionality)
25. [Validation dengan XML Schema / XSD](#25-validation-dengan-xml-schema--xsd)
26. [ValidationEventHandler](#26-validationeventhandler)
27. [XJC: Generate Java dari XSD](#27-xjc-generate-java-dari-xsd)
28. [SchemaGen: Generate XSD dari Java](#28-schemagen-generate-xsd-dari-java)
29. [Marshalling/Unmarshalling dari File, Stream, DOM, SAX, StAX, Source](#29-marshallingunmarshalling-dari-file-stream-dom-sax-stax-source)
30. [Large XML: Streaming Boundary dan Memory](#30-large-xml-streaming-boundary-dan-memory)
31. [Security: XXE, Entity Expansion, SSRF, XML Bomb](#31-security-xxe-entity-expansion-ssrf-xml-bomb)
32. [Performance Engineering](#32-performance-engineering)
33. [Thread Safety dan Object Reuse](#33-thread-safety-dan-object-reuse)
34. [Error Handling dan Diagnostics](#34-error-handling-dan-diagnostics)
35. [Versioning dan Schema Evolution](#35-versioning-dan-schema-evolution)
36. [Interoperability: SOAP, SFTP/XML Files, Government/Banking Integration](#36-interoperability-soap-sftpxml-files-governmentbanking-integration)
37. [Migration: `javax.xml.bind` → `jakarta.xml.bind`](#37-migration-javaxxmlbind--jakartaxmlbind)
38. [Java 11+ dan JAXB Hilang dari JDK](#38-java-11-dan-jaxb-hilang-dari-jdk)
39. [Testing Strategy](#39-testing-strategy)
40. [Observability dan Operational Runbook](#40-observability-dan-operational-runbook)
41. [Production Failure Modes](#41-production-failure-modes)
42. [Best Practices dan Anti-Patterns](#42-best-practices-dan-anti-patterns)
43. [Checklist Review](#43-checklist-review)
44. [Case Study 1: XML File Exchange dengan External Agency](#44-case-study-1-xml-file-exchange-dengan-external-agency)
45. [Case Study 2: Migrasi Java 8 JAXB ke Java 21 Jakarta XML Binding](#45-case-study-2-migrasi-java-8-jaxb-ke-java-21-jakarta-xml-binding)
46. [Case Study 3: XXE dari XML Partner yang Tidak Diproteksi](#46-case-study-3-xxe-dari-xml-partner-yang-tidak-diproteksi)
47. [Case Study 4: Huge XML Membuat Heap Meledak](#47-case-study-4-huge-xml-membuat-heap-meledak)
48. [Latihan Bertahap](#48-latihan-bertahap)
49. [Mini Project: Jakarta XML Binding Production Lab](#49-mini-project-jakarta-xml-binding-production-lab)
50. [Referensi Resmi](#50-referensi-resmi)

---

# 1. Orientasi: Kenapa XML Binding Masih Penting?

Banyak engineer modern lebih sering bekerja dengan JSON.

Namun XML masih hidup di enterprise:

- government data exchange;
- banking/finance;
- insurance;
- healthcare;
- logistics;
- SOAP legacy services;
- SFTP file integration;
- batch regulatory reports;
- e-invoice/e-tax formats;
- digital signatures / XML Signature;
- standards yang sudah berumur panjang;
- partner integration yang tidak mudah diganti.

Jakarta XML Binding membantu mengubah:

```text
XML document ↔ Java object graph
```

Tanpa harus menulis parser manual untuk setiap tag.

## 1.1 Problem yang diselesaikan

Tanpa binding, kamu mungkin menulis:

```java
Document doc = builder.parse(file);
String name = doc.getElementsByTagName("name").item(0).getTextContent();
```

Untuk XML kecil, ini masih oke.

Untuk XML contract besar, nested, namespaced, versioned, dan schema-driven, ini cepat menjadi kompleks.

Dengan Jakarta XML Binding:

```java
Customer customer = (Customer) unmarshaller.unmarshal(file);
```

dan:

```java
marshaller.marshal(customer, outputStream);
```

## 1.2 Binding bukan sekadar parser

Parser membaca XML.

Binding framework menghubungkan XML structure dengan Java object model.

## 1.3 JAXB mindset

JAXB/Jakarta XML Binding cocok ketika:

- XML contract cukup stabil;
- ada XSD;
- object graph cocok dengan XML structure;
- kamu butuh marshal/unmarshal;
- kamu butuh validation;
- kamu berintegrasi dengan SOAP/XML legacy.

## 1.4 Kapan kurang cocok?

Kurang cocok jika:

- XML sangat besar dan harus diproses streaming record-by-record;
- struktur sangat dinamis;
- kamu hanya butuh extract beberapa field;
- XML tidak mengikuti schema;
- object graph terlalu berat;
- security parser belum dikontrol;
- kamu butuh ultra-low memory.

## 1.5 Prinsip utama

```text
Use XML binding at the boundary.
Keep domain model independent from partner XML shape when contract is external.
```

Jangan biarkan XML partner schema merusak domain model internal.

---

# 2. Status Modern: Jakarta XML Binding 4.0 dan Jakarta EE 11

Ini bagian penting.

Jakarta XML Binding 4.0 adalah release untuk Jakarta EE 10.

Namun Jakarta EE 11 Platform menghapus Jakarta XML Binding dari platform.

Artinya:

```text
Jakarta EE 11 runtime tidak wajib menyediakan XML Binding API/implementation sebagai bagian platform.
```

## 2.1 Implikasi praktis

Jika kamu memakai Jakarta EE 11 dan butuh XML Binding, kamu harus:

- menambahkan dependency eksplisit;
- memastikan implementation tersedia;
- memastikan runtime/classloading cocok;
- tidak mengasumsikan `jakarta.xml.bind` otomatis ada dari platform.

## 2.2 Standalone spec tetap relevan

Walaupun removed from platform, Jakarta XML Binding tetap ada sebagai standalone Jakarta specification.

Ini mirip pola:

```text
not in platform ≠ dead
```

Ia masih dipakai untuk interoperability dan XML-heavy systems.

## 2.3 Kenapa removed?

Jakarta EE 11 melakukan modernization dan menghapus beberapa teknologi lama/opsional dari platform, termasuk XML Web Services, XML Binding, dan SOAP with Attachments.

Namun organisasi yang masih punya XML/SOAP integration tetap bisa memakai spec ini secara eksplisit.

## 2.4 Jakarta XML Binding 4.1

Jakarta XML Binding 4.1 sedang dikembangkan untuk Jakarta EE 12.

Target materi ini: Jakarta XML Binding 4.0 karena itu versi stabil utama modern.

## 2.5 Penting untuk dependency strategy

Dalam project modern:

```xml
jakarta.xml.bind-api
jaxb-runtime / implementation
```

harus dipilih sadar.

Jangan hanya mengandalkan umbrella Jakarta EE API.

---

# 3. Mental Model: XML Tree ↔ Java Object Graph

XML adalah tree:

```xml
<customer id="C001">
  <name>Fajar</name>
  <email>fajar@example.com</email>
</customer>
```

Java object graph:

```java
Customer(
  id = "C001",
  name = "Fajar",
  email = "fajar@example.com"
)
```

Jakarta XML Binding menyediakan aturan mapping.

## 3.1 XML concepts

- element;
- attribute;
- text content;
- namespace;
- prefix;
- QName;
- schema type;
- order;
- occurrence constraints;
- nil;
- mixed content;
- complex type;
- simple type.

## 3.2 Java concepts

- class;
- field;
- property;
- constructor;
- enum;
- list;
- inheritance;
- annotation;
- adapter;
- object factory.

## 3.3 Binding rules

Binding menjawab:

```text
XML element customer maps to class Customer
XML attribute id maps to field id
XML child element name maps to field name
```

## 3.4 Marshalling

```text
Java object graph → XML document
```

## 3.5 Unmarshalling

```text
XML document → Java object graph
```

## 3.6 Validation

```text
XML document/object graph conforms to XSD?
```

## 3.7 Contract boundary

XML binding berada di edge:

```text
external XML contract ↔ internal application model
```

Jangan campur semua model.

---

# 4. XML Binding vs XML Parser vs JSON-B vs SOAP

## 4.1 XML parser

Low-level parsing:

- DOM;
- SAX;
- StAX.

Good for:

- custom processing;
- very large XML;
- streaming;
- partial extraction.

## 4.2 XML Binding

Object mapping:

- annotations;
- schema binding;
- marshalling/unmarshalling;
- validation.

Good for structured XML contract.

## 4.3 JSON-B

Object mapping for JSON:

```text
JSON ↔ Java object
```

Similar mental model but different data model.

## 4.4 SOAP

Messaging/web service protocol using XML envelope.

Jakarta XML Binding is often used underneath SOAP stacks for payload binding.

## 4.5 Decision table

| Need | Prefer |
|---|---|
| Parse huge XML event-by-event | StAX/SAX |
| Load entire XML tree manually | DOM |
| Map XML contract to objects | Jakarta XML Binding |
| Map JSON to objects | JSON-B/Jackson |
| SOAP web service | Jakarta XML Web Services stack / SOAP tooling |
| Extract 2 fields from massive file | StAX |
| Validate document against XSD | SchemaFactory + JAXB validation or parser validation |
| Partner sends fixed XML schema | JAXB schema-first |

## 4.6 Binding hides XML details

This is useful, but dangerous if you need exact control of namespaces/order/signature canonicalization.

For digitally signed XML, be extremely careful: marshalling can alter formatting/namespace prefixes and break signatures.

---

# 5. Dependency, Runtime, API, dan Implementation

## 5.1 API dependency

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
  <version>4.0.2</version>
</dependency>
```

Version may vary; align with runtime.

## 5.2 Implementation dependency

API is not enough.

Common implementation:

```xml
<dependency>
  <groupId>org.glassfish.jaxb</groupId>
  <artifactId>jaxb-runtime</artifactId>
  <version>4.0.x</version>
</dependency>
```

## 5.3 Jakarta EE 11 note

Because XML Binding is removed from Jakarta EE 11 Platform, add explicit dependency if needed.

## 5.4 Java 11+ note

JAXB was removed from Java SE after Java 10 era. On Java 11+, you need dependencies explicitly.

## 5.5 Maven example

```xml
<dependencies>
  <dependency>
    <groupId>jakarta.xml.bind</groupId>
    <artifactId>jakarta.xml.bind-api</artifactId>
    <version>4.0.2</version>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jaxb</groupId>
    <artifactId>jaxb-runtime</artifactId>
    <version>4.0.5</version>
  </dependency>
</dependencies>
```

## 5.6 Module path

If using JPMS/module path, check module names and runtime dependencies.

## 5.7 Classpath conflicts

Common conflict:

- old `javax.xml.bind` API;
- new `jakarta.xml.bind` API;
- implementation mismatch;
- transitive dependencies pulling old JAXB.

## 5.8 Rule

```text
API version, implementation version, namespace, and runtime must agree.
```

---

# 6. Peta API `jakarta.xml.bind`

Important package:

```java
jakarta.xml.bind
```

Important annotations package:

```java
jakarta.xml.bind.annotation
```

Important adapters package:

```java
jakarta.xml.bind.annotation.adapters
```

## 6.1 Runtime core

- `JAXBContext`;
- `Marshaller`;
- `Unmarshaller`;
- `JAXBElement`;
- `JAXB`;
- `ValidationEvent`;
- `ValidationEventHandler`;
- `ValidationEventLocator`;
- `JAXBException`;
- `MarshalException`;
- `UnmarshalException`;
- `PropertyException`.

## 6.2 Annotations

- `@XmlRootElement`;
- `@XmlType`;
- `@XmlElement`;
- `@XmlAttribute`;
- `@XmlAccessorType`;
- `@XmlAccessType`;
- `@XmlElementWrapper`;
- `@XmlTransient`;
- `@XmlValue`;
- `@XmlEnum`;
- `@XmlEnumValue`;
- `@XmlSeeAlso`;
- `@XmlAnyElement`;
- `@XmlAnyAttribute`;
- `@XmlSchema`;
- `@XmlNs`.

## 6.3 Adapters

- `XmlAdapter`;
- `@XmlJavaTypeAdapter`.

## 6.4 Schema tools

Tools are often implementation-provided:

- `xjc`;
- `schemagen`.

## 6.5 Streaming integration

Works with:

- `File`;
- `InputStream`;
- `Reader`;
- `URL`;
- DOM `Node`;
- SAX `Source`;
- StAX `XMLStreamReader`;
- `javax.xml.transform.Source`;
- `Result`.

## 6.6 Package naming caution

`jakarta.xml.bind` uses Jakarta namespace, but many XML parser APIs remain in Java SE packages:

```java
javax.xml.parsers
javax.xml.stream
javax.xml.transform
javax.xml.validation
org.w3c.dom
org.xml.sax
```

Not all `javax.*` XML packages migrated.

---

# 7. `JAXBContext`: Binding Runtime Entry Point

`JAXBContext` is the entry point.

It manages binding metadata for one or more classes/packages.

## 7.1 Create context by class

```java
JAXBContext context = JAXBContext.newInstance(Customer.class);
```

## 7.2 Create context for multiple classes

```java
JAXBContext context = JAXBContext.newInstance(
    Customer.class,
    Address.class,
    Order.class
);
```

## 7.3 Create marshaller

```java
Marshaller marshaller = context.createMarshaller();
```

## 7.4 Create unmarshaller

```java
Unmarshaller unmarshaller = context.createUnmarshaller();
```

## 7.5 Expensive object

`JAXBContext` creation is relatively expensive.

Cache/reuse it.

## 7.6 Thread safety

`JAXBContext` is generally safe to reuse.

`Marshaller` and `Unmarshaller` are not generally treated as thread-safe; create per operation or use thread-confined pool.

## 7.7 Context scope

Do not create one context per request if high throughput.

Use application-level cache:

```java
private static final JAXBContext CUSTOMER_CONTEXT = ...
```

or DI-managed singleton.

## 7.8 Context path

You can create context by package/context path in schema-generated models.

## 7.9 Provider lookup

Jakarta XML Binding 4.0 changed provider lookup behavior compared with older versions. Prefer explicit dependencies and tested initialization.

---

# 8. `Marshaller`: Java Object → XML

Marshaller converts Java object graph into XML.

## 8.1 Basic marshalling

```java
JAXBContext context = JAXBContext.newInstance(Customer.class);
Marshaller marshaller = context.createMarshaller();

marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
marshaller.marshal(customer, outputStream);
```

## 8.2 Output targets

Can marshal to:

- `File`;
- `OutputStream`;
- `Writer`;
- DOM `Node`;
- SAX `ContentHandler`;
- StAX `XMLStreamWriter`;
- `Result`.

## 8.3 Formatted output

```java
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
```

Good for humans; not always for signed XML.

## 8.4 Encoding

```java
marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
```

## 8.5 Fragment mode

```java
marshaller.setProperty(Marshaller.JAXB_FRAGMENT, true);
```

Suppress XML declaration if embedding fragment.

## 8.6 Schema location

```java
marshaller.setProperty(Marshaller.JAXB_SCHEMA_LOCATION, "namespace schema.xsd");
```

## 8.7 Validation during marshal

Set schema:

```java
marshaller.setSchema(schema);
```

## 8.8 Error handling

Marshaller may throw `MarshalException` or `JAXBException`.

Include object type and target info in logs.

## 8.9 Side effect caution

Marshalling reads object graph. Avoid lazy-loading surprises if using JPA entities.

Prefer DTOs.

---

# 9. `Unmarshaller`: XML → Java Object

Unmarshaller converts XML into Java objects.

## 9.1 Basic unmarshalling

```java
JAXBContext context = JAXBContext.newInstance(Customer.class);
Unmarshaller unmarshaller = context.createUnmarshaller();

Customer customer = (Customer) unmarshaller.unmarshal(inputStream);
```

## 9.2 Type-safe unmarshal with declared type

```java
JAXBElement<Customer> element =
    unmarshaller.unmarshal(source, Customer.class);

Customer customer = element.getValue();
```

Useful if root element not directly annotated with `@XmlRootElement`.

## 9.3 Input sources

Can unmarshal from:

- `File`;
- `InputStream`;
- `Reader`;
- `URL`;
- DOM `Node`;
- SAX `Source`;
- StAX `XMLStreamReader`;
- `Source`.

## 9.4 Schema validation

```java
unmarshaller.setSchema(schema);
```

## 9.5 Validation event handler

```java
unmarshaller.setEventHandler(event -> {
    log.warn("XML validation event: {}", event.getMessage());
    return false; // stop on first error
});
```

## 9.6 Security caution

Do not unmarshal untrusted XML with insecure parser config.

If using StAX/SAX source, configure parser securely.

## 9.7 Partial unmarshalling

Use StAX to move to element and unmarshal one object at a time for large files.

## 9.8 Unknown elements

Default behavior can be tolerant depending context. Be explicit with validation when contract strictness matters.

---

# 10. `JAXB`: Convenience API

`jakarta.xml.bind.JAXB` provides convenience methods.

## 10.1 Marshal convenience

```java
JAXB.marshal(customer, file);
```

## 10.2 Unmarshal convenience

```java
Customer customer = JAXB.unmarshal(file, Customer.class);
```

## 10.3 Good for learning/small utilities

Convenient for simple cases.

## 10.4 Not ideal for production hot path

Because it can hide context creation and configuration.

Production often needs:

- cached `JAXBContext`;
- secure parser;
- schema validation;
- event handling;
- custom properties;
- streaming;
- observability.

## 10.5 Rule

Use convenience API for simple tools/tests.

Use explicit context/marshaller/unmarshaller for production boundaries.

---

# 11. Code-First Binding: Java Class sebagai Source of Truth

Code-first means Java classes define XML shape.

## 11.1 Example

```java
@XmlRootElement(name = "customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    @XmlAttribute
    private String id;

    @XmlElement
    private String name;

    @XmlElement
    private String email;

    public CustomerXml() {
    }
}
```

## 11.2 Pros

- natural for Java teams;
- quick;
- good for internal XML;
- less XSD ceremony.

## 11.3 Cons

- XML contract can drift with Java refactor;
- schema may be implicit;
- external partners often need XSD;
- annotations pollute model;
- order/namespace can be accidental.

## 11.4 Good use cases

- internal config;
- simple export;
- owned XML contract;
- test fixtures.

## 11.5 Avoid binding domain directly

Better:

```text
Domain Customer
  ↔ mapper
CustomerXml DTO
```

This isolates XML shape.

## 11.6 Schema generation

Can generate XSD from Java, but generated schema may not be ideal as public contract unless reviewed.

---

# 12. Schema-First Binding: XSD sebagai Contract

Schema-first means XSD defines contract, then Java classes generated or hand-written to match.

## 12.1 Flow

```text
customer.xsd
  ↓ xjc
generated Java classes
  ↓ application maps to/from domain
```

## 12.2 Pros

- strong external contract;
- partner interoperability;
- validation clear;
- namespace/type/occurrence controlled;
- compatible with regulated industries.

## 12.3 Cons

- generated classes can be ugly;
- object model follows XML, not domain;
- regeneration workflow needed;
- custom binding files may be required.

## 12.4 Good use cases

- government agency schema;
- bank/insurance XML;
- SOAP WSDL/XSD;
- e-invoice/e-tax;
- official file exchange.

## 12.5 Binding customization

Use binding files to control:

- package names;
- class names;
- type mapping;
- adapters;
- collection naming.

## 12.6 Do not edit generated code manually

Generated code should be reproducible.

Customize generation, not output.

---

# 13. Annotation Model

Annotations define XML mapping.

## 13.1 Field vs property

Can annotate fields or getters.

Be consistent.

## 13.2 Common annotations

```java
@XmlRootElement
@XmlType
@XmlAccessorType
@XmlElement
@XmlAttribute
@XmlElementWrapper
@XmlTransient
@XmlValue
@XmlJavaTypeAdapter
```

## 13.3 Annotation scope

Annotations can be on:

- class;
- field;
- getter;
- package;
- enum;
- adapter.

## 13.4 No-arg constructor

JAXB often requires no-arg constructor for classes.

## 13.5 Access strategy matters

Mixing field and property annotations can cause duplicate property errors.

## 13.6 Immutable models

JAXB historically favors mutable POJOs.

For immutable/domain models, use XML DTOs + mapper.

## 13.7 Records

Records may not fit classic JAXB binding model cleanly across implementations/version. Test before designing contract around records.

## 13.8 Avoid annotation pollution

External XML contract annotations should be on boundary DTOs, not core domain.

---

# 14. `@XmlRootElement`, `@XmlType`, `@XmlElement`, `@XmlAttribute`

## 14.1 `@XmlRootElement`

Marks class as XML root element.

```java
@XmlRootElement(name = "customer")
public class CustomerXml { ... }
```

## 14.2 Missing root element

If absent, marshalling as document root may require `JAXBElement`.

## 14.3 `@XmlType`

Controls type name and property order.

```java
@XmlType(
    name = "CustomerType",
    propOrder = {"name", "email"}
)
```

## 14.4 `@XmlElement`

Maps field/property to XML element.

```java
@XmlElement(name = "email", required = true)
private String email;
```

## 14.5 `@XmlAttribute`

Maps field/property to XML attribute.

```java
@XmlAttribute(name = "id", required = true)
private String id;
```

## 14.6 Element vs attribute decision

Attributes often for metadata/identifiers.

Elements often for structured data.

Follow schema/partner contract.

## 14.7 Required caveat

`required=true` affects schema generation/metadata, not always runtime validation unless schema validation is enabled.

## 14.8 Order

XML order matters for many schemas.

Use `propOrder`.

---

# 15. `@XmlAccessorType`: Field vs Property Binding

`@XmlAccessorType` controls default access.

## 15.1 Field access

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    private String name;
}
```

JAXB accesses fields.

## 15.2 Property access

```java
@XmlAccessorType(XmlAccessType.PROPERTY)
public class CustomerXml {
    public String getName() { ... }
    public void setName(String name) { ... }
}
```

JAXB accesses getters/setters.

## 15.3 Public member access

`PUBLIC_MEMBER` binds public fields/properties.

## 15.4 None

`NONE` binds only explicitly annotated members.

## 15.5 Recommendation

Use:

```java
@XmlAccessorType(XmlAccessType.FIELD)
```

for XML DTOs to reduce accidental getter behavior.

## 15.6 Avoid mixing

Mixed annotations can cause:

```text
Class has two properties of the same name
```

## 15.7 Package-level default

Set at package level in `package-info.java`.

---

# 16. Collection, Wrapper, dan Order

## 16.1 List without wrapper

```java
@XmlElement(name = "item")
private List<ItemXml> items;
```

XML:

```xml
<item>...</item>
<item>...</item>
```

## 16.2 List with wrapper

```java
@XmlElementWrapper(name = "items")
@XmlElement(name = "item")
private List<ItemXml> items;
```

XML:

```xml
<items>
  <item>...</item>
  <item>...</item>
</items>
```

## 16.3 Order matters

Use `@XmlType(propOrder = {...})`.

## 16.4 Null vs empty collection

Decide:

```text
missing element
empty wrapper
wrapper with no child
```

Partner schema may distinguish.

## 16.5 Live lists in generated code

XJC-generated classes often expose live list getter:

```java
public List<Item> getItem() {
    if (item == null) item = new ArrayList<>();
    return this.item;
}
```

No setter.

This is normal JAXB pattern.

## 16.6 Domain mapping

Do not expose live JAXB lists as domain collections directly.

Map to immutable domain structures.

---

# 17. `JAXBElement`: Ketika Root Element Tidak Langsung Ada

Sometimes class lacks `@XmlRootElement`.

Then use `JAXBElement`.

## 17.1 Example

```java
QName name = new QName("https://example.com/customer", "customer");

JAXBElement<CustomerXml> root =
    new JAXBElement<>(name, CustomerXml.class, customer);

marshaller.marshal(root, outputStream);
```

## 17.2 Unmarshal declared type

```java
JAXBElement<CustomerXml> element =
    unmarshaller.unmarshal(source, CustomerXml.class);

CustomerXml customer = element.getValue();
```

## 17.3 Why exists?

XML element name and Java type are not always one-to-one.

A type can be used under different element names.

## 17.4 Common in generated code

XJC often generates `ObjectFactory` methods returning `JAXBElement`.

## 17.5 Debugging

If marshalling fails:

```text
unable to marshal type as an element because it is missing @XmlRootElement
```

Use `JAXBElement` or add root annotation if appropriate.

---

# 18. `ObjectFactory` dan `@XmlElementDecl`

Schema-generated packages often include `ObjectFactory`.

## 18.1 Purpose

Factory methods for generated classes and element declarations.

## 18.2 Example concept

```java
@XmlRegistry
public class ObjectFactory {

    private static final QName CUSTOMER_QNAME =
        new QName("https://example.com/customer", "customer");

    public CustomerXml createCustomerXml() {
        return new CustomerXml();
    }

    @XmlElementDecl(namespace = "https://example.com/customer", name = "customer")
    public JAXBElement<CustomerXml> createCustomer(CustomerXml value) {
        return new JAXBElement<>(CUSTOMER_QNAME, CustomerXml.class, null, value);
    }
}
```

## 18.3 Why useful?

Preserves schema element/type information.

## 18.4 Use in schema-first flow

Instead of manually creating QName each time, use factory.

## 18.5 Package context

`ObjectFactory` helps package-based `JAXBContext`.

## 18.6 Do not delete generated ObjectFactory

It may be required for binding metadata.

---

# 19. Namespace dan QName

XML namespaces are central.

## 19.1 Namespace URI vs prefix

URI defines identity.

Prefix is shorthand in document.

```xml
<cust:customer xmlns:cust="https://example.com/customer">
```

Prefix `cust` can change; URI matters.

## 19.2 QName

Qualified name:

```text
{namespaceURI}localPart
```

Java:

```java
QName q = new QName("https://example.com/customer", "customer");
```

## 19.3 Annotation namespace

```java
@XmlRootElement(
    name = "customer",
    namespace = "https://example.com/customer"
)
```

## 19.4 Package-level namespace

Use `@XmlSchema` in `package-info.java`.

## 19.5 Namespace mismatch

Common unmarshal failure:

```text
unexpected element: expected {A}customer but found {B}customer
```

## 19.6 Prefix control

Prefix control is implementation-specific in many cases.

Do not rely on prefix unless partner/signature requires it.

## 19.7 XML signature caution

Namespace prefix and canonicalization matter for signed XML. Test exact output.

---

# 20. Package-Level Metadata: `package-info.java`

Package-level annotations reduce repetition.

## 20.1 Example

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "https://example.com/customer",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED
)
package com.example.integration.customer.xml;
```

## 20.2 Benefits

- central namespace;
- consistent element qualification;
- less annotation noise.

## 20.3 Common attributes

- `namespace`;
- `elementFormDefault`;
- `attributeFormDefault`;
- `xmlns`.

## 20.4 `elementFormDefault`

Controls whether local elements are namespace-qualified.

Schema mismatch often comes from this.

## 20.5 Package names

Schema-first tools generate package based on namespace or binding customization.

## 20.6 Migration

Ensure `package-info.java` imports move from `javax.xml.bind.annotation` to `jakarta.xml.bind.annotation`.

---

# 21. `XmlAdapter`: Adaptasi Tipe yang Tidak Natural di XML

`XmlAdapter<ValueType, BoundType>` converts between XML-friendly type and Java-friendly type.

## 21.1 Use cases

- `LocalDate`;
- `Instant`;
- `Money`;
- `UUID`;
- custom ID value object;
- encrypted/masked field;
- non-default map structure.

## 21.2 Example

```java
public class LocalDateAdapter extends XmlAdapter<String, LocalDate> {

    @Override
    public LocalDate unmarshal(String value) {
        return value == null ? null : LocalDate.parse(value);
    }

    @Override
    public String marshal(LocalDate value) {
        return value == null ? null : value.toString();
    }
}
```

Use:

```java
@XmlJavaTypeAdapter(LocalDateAdapter.class)
private LocalDate birthDate;
```

## 21.3 Adapter direction

`ValueType` is XML representation.

`BoundType` is Java field type.

## 21.4 Register globally

Can apply at package/class/field level depending annotation.

## 21.5 Keep adapters pure

No DB/external service calls.

## 21.6 Error handling

Throw meaningful exception for invalid lexical value.

## 21.7 Security

Adapters may parse user-controlled XML. Validate strictly.

---

# 22. Date/Time, BigDecimal, Enum, Optional, dan Records

## 22.1 Date/time

XML Schema has types like:

- `xs:date`;
- `xs:dateTime`;
- `xs:time`.

Java mapping can involve:

- `XMLGregorianCalendar`;
- `Date`;
- adapters to `LocalDate`, `Instant`, etc.

## 22.2 Prefer explicit adapter

Modern Java apps often use `java.time`.

Use adapters to avoid ambiguous timezone handling.

## 22.3 BigDecimal

Use for monetary/precise decimal.

Avoid double for money.

## 22.4 Enum

```java
@XmlEnum
public enum StatusXml {
    @XmlEnumValue("ACTIVE")
    ACTIVE
}
```

## 22.5 Optional

`Optional<T>` is not usually a good JAXB field type.

Use nullable field in XML DTO, map to Optional in domain if desired.

## 22.6 Records

Classic JAXB expects mutable classes/no-arg constructor.

Records may not be portable across implementations for JAXB binding.

Use DTO classes or test implementation-specific support carefully.

## 22.7 Domain vs XML DTO

For modern domain model, map:

```text
XML DTO mutable JAXB-friendly
  ↔ mapper
Domain immutable/record/value objects
```

---

# 23. Inheritance dan Polymorphism

XML Schema supports type hierarchies.

JAXB supports polymorphism but must be explicit.

## 23.1 `@XmlSeeAlso`

```java
@XmlSeeAlso({CardPaymentXml.class, BankTransferXml.class})
public abstract class PaymentXml { ... }
```

## 23.2 `xsi:type`

XML can indicate actual subtype:

```xml
<payment xsi:type="cardPayment">
```

## 23.3 `@XmlElements`

Map multiple element names to types.

```java
@XmlElements({
    @XmlElement(name = "card", type = CardPaymentXml.class),
    @XmlElement(name = "bank", type = BankTransferXml.class)
})
private PaymentXml payment;
```

## 23.4 Caution

Polymorphic XML can become hard to evolve.

## 23.5 Security

Do not allow arbitrary type resolution from untrusted XML beyond expected classes.

JAXB is not Java serialization, but type handling still needs control.

## 23.6 Prefer simple explicit models

For external contracts, explicit elements often clearer than polymorphic magic.

---

# 24. Nil, Null, Empty Element, dan Optionality

XML has nuanced absence semantics.

## 24.1 Missing element

```xml
<customer>
</customer>
```

No `<email>`.

## 24.2 Empty element

```xml
<email/>
```

May mean empty string or empty content.

## 24.3 Nil element

```xml
<email xsi:nil="true"/>
```

Explicit null.

## 24.4 JAXB annotation

```java
@XmlElement(nillable = true)
private String email;
```

## 24.5 Schema occurrence

XSD:

```xml
minOccurs="0"
nillable="true"
```

These are not identical.

## 24.6 Business meaning

Define clearly:

- absent = unknown?
- empty = intentionally empty?
- nil = null?
- default value?

## 24.7 Validation

Use schema validation and business validation.

## 24.8 Mapping to domain

Do not let ambiguous XML null semantics leak into domain without decision.

---

# 25. Validation dengan XML Schema / XSD

Validation ensures XML conforms to schema.

## 25.1 Create schema

```java
SchemaFactory factory =
    SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);

Schema schema = factory.newSchema(new File("customer.xsd"));
```

## 25.2 Set on unmarshaller

```java
Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setSchema(schema);
```

## 25.3 Set on marshaller

```java
Marshaller marshaller = context.createMarshaller();
marshaller.setSchema(schema);
```

## 25.4 Unmarshal validation

Catches invalid incoming XML.

## 25.5 Marshal validation

Catches invalid outgoing XML before sending.

## 25.6 Validation is not business validation

XSD can validate structure/type.

Business rules still need Java validation.

Example:

```text
if status=APPROVED, approvalDate required
```

may be hard in XSD.

## 25.7 Security

Configure `SchemaFactory` securely when schema/external references involved.

Disable external access if needed.

## 25.8 Cache schema

Schema creation can be expensive.

Cache validated trusted schema object.

---

# 26. ValidationEventHandler

`ValidationEventHandler` handles validation events.

## 26.1 Example

```java
unmarshaller.setEventHandler(event -> {
    ValidationEventLocator loc = event.getLocator();

    log.warn(
        "XML validation severity={} line={} column={} message={}",
        event.getSeverity(),
        loc.getLineNumber(),
        loc.getColumnNumber(),
        event.getMessage()
    );

    return false; // stop processing
});
```

## 26.2 Return value

- `true`: continue;
- `false`: stop.

## 26.3 Severity

Events can have severity such as warning/error/fatal.

## 26.4 Use for diagnostics

Log line/column and message.

## 26.5 Do not continue blindly

Continuing after validation error may produce partially invalid object graph.

## 26.6 Partner integration

Return structured error report to partner if this is file ingestion.

## 26.7 Observability

Count validation failures by schema version/partner/file type.

---

# 27. XJC: Generate Java dari XSD

XJC generates Java classes from XML Schema.

## 27.1 Concept

```text
customer.xsd
  ↓ xjc
Customer.java
ObjectFactory.java
package-info.java
```

## 27.2 Why use it?

When XSD is source of truth.

## 27.3 Generated code

Generated classes may:

- be mutable;
- expose live lists;
- use `JAXBElement`;
- include annotations;
- include `ObjectFactory`.

## 27.4 Binding customization

Use binding files to customize:

- package;
- class names;
- type names;
- adapters;
- enum mapping;
- collection names.

## 27.5 Build integration

Use Maven/Gradle plugin.

Generated code should be reproducible.

## 27.6 Do not manually edit generated classes

Customize input/bindings.

## 27.7 Version control

Two options:

- commit generated source for traceability;
- generate in build.

Choose based on team/build reproducibility.

## 27.8 Test generation

Schema changes should trigger tests.

---

# 28. SchemaGen: Generate XSD dari Java

SchemaGen generates schema from annotated Java classes.

## 28.1 Concept

```text
CustomerXml.java
  ↓ schemagen
customer.xsd
```

## 28.2 Good use

- internal contract;
- documentation;
- starting point for schema;
- simple data export.

## 28.3 Caution

Generated schema may not be ideal for partner/public contract.

Review and curate.

## 28.4 Code-first drift

Refactoring Java can change generated schema.

## 28.5 Versioning

Public schema should be versioned deliberately, not accidentally.

## 28.6 CI check

If schema generated from code, detect unintended changes.

---

# 29. Marshalling/Unmarshalling dari File, Stream, DOM, SAX, StAX, Source

JAXB integrates with many XML APIs.

## 29.1 File

```java
CustomerXml c = (CustomerXml) unmarshaller.unmarshal(file);
```

## 29.2 InputStream

```java
CustomerXml c = (CustomerXml) unmarshaller.unmarshal(inputStream);
```

Remember to close stream.

## 29.3 Reader

Useful for character stream.

## 29.4 DOM

```java
Node node = ...
Object obj = unmarshaller.unmarshal(node);
```

DOM loads full tree in memory.

## 29.5 SAX Source

Can use secured SAX parser.

## 29.6 StAX XMLStreamReader

Useful for streaming partial unmarshalling.

```java
XMLStreamReader reader = xmlInputFactory.createXMLStreamReader(inputStream);
```

Move reader to desired element, then:

```java
JAXBElement<RecordXml> record =
    unmarshaller.unmarshal(reader, RecordXml.class);
```

## 29.7 Source/Result

JAXB works with `javax.xml.transform.Source` and `Result` API.

## 29.8 Security

Input source choice affects security configuration.

Do not just pass `File`/`InputStream` with insecure defaults for untrusted XML.

---

# 30. Large XML: Streaming Boundary dan Memory

JAXB unmarshalling whole document creates object graph in memory.

For huge XML, this can explode heap.

## 30.1 Bad

```java
ReportXml report = (ReportXml) unmarshaller.unmarshal(hugeFile);
```

If file has millions of records, object graph huge.

## 30.2 Better

Use StAX to stream records:

```text
open XMLStreamReader
  ↓ move to each <record>
  ↓ unmarshal one record
  ↓ process
  ↓ discard
```

## 30.3 Hybrid approach

Use JAXB for each record element, not whole file.

## 30.4 Backpressure

If records are written to DB/API, batch and control throughput.

## 30.5 Checkpoint

For batch processing, combine with Jakarta Batch or custom checkpoint.

## 30.6 Memory rules

- do not hold all records;
- do not build DOM for huge file;
- process incrementally;
- close resources;
- validate carefully.

## 30.7 Error handling

For large file, define:

- fail-fast vs collect errors;
- max error count;
- reject file vs partial accept;
- line/record number diagnostics.

---

# 31. Security: XXE, Entity Expansion, SSRF, XML Bomb

XML parsing is security-sensitive.

## 31.1 XXE

External Entity attack can read files or make network requests.

Malicious XML:

```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<customer>&xxe;</customer>
```

## 31.2 SSRF

External entity or schema location can trigger server-side network calls.

## 31.3 XML bomb

Entity expansion attack:

```xml
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;...">
]>
```

Can exhaust CPU/memory.

## 31.4 Disable DTD/external entities

When using parser factories, configure secure processing.

Example StAX:

```java
XMLInputFactory factory = XMLInputFactory.newFactory();
factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
```

Also use secure processing and restrict external schema access where applicable.

## 31.5 SchemaFactory restrictions

```java
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
```

## 31.6 Do not trust schemaLocation

Incoming XML can include `xsi:schemaLocation`.

Do not let it fetch arbitrary schemas.

## 31.7 File upload

If XML comes from upload/SFTP/partner:

- limit size;
- scan malware if needed;
- parse securely;
- validate schema;
- audit source;
- quarantine invalid files.

## 31.8 Rule

```text
Untrusted XML must never be parsed with default insecure assumptions.
```

---

# 32. Performance Engineering

## 32.1 Cache JAXBContext

Expensive to create.

## 32.2 Create marshaller/unmarshaller per operation

They are not generally thread-safe.

## 32.3 Cache schema

Schema creation expensive.

## 32.4 Use streaming for large XML

Avoid full DOM/object graph.

## 32.5 Avoid formatted output in machine-to-machine hot path

Pretty printing increases size and CPU.

## 32.6 Avoid JPA lazy loading during marshalling

JAXB traverses object graph.

Could trigger N+1 or LazyInitializationException.

Use XML DTOs.

## 32.7 Measure output size

XML is verbose.

Compression may help for transport/storage.

## 32.8 Namespace prefix mapping

Custom prefix mapping may be implementation-specific and can add overhead/complexity.

## 32.9 Validation cost

Schema validation adds cost.

Use where contract safety matters.

## 32.10 Benchmark realistic payloads

Small examples hide real costs.

---

# 33. Thread Safety dan Object Reuse

## 33.1 JAXBContext

Reuse/caching recommended.

## 33.2 Marshaller

Do not share concurrently.

Create per call or pool carefully.

## 33.3 Unmarshaller

Do not share concurrently.

## 33.4 Schema

Schema instances are generally reusable/thread-safe depending API contract; use as immutable object.

## 33.5 Adapter instances

Adapters may be instantiated/used by runtime.

Make adapters stateless/thread-safe.

## 33.6 Object reuse

Do not reuse target DTOs between requests.

## 33.7 Pooling

Pooling marshaller/unmarshaller can help but adds complexity:

- reset properties;
- reset event handlers;
- reset adapters;
- avoid cross-request leakage.

Often creation from cached context is enough.

---

# 34. Error Handling dan Diagnostics

## 34.1 Exception types

Common:

- `JAXBException`;
- `MarshalException`;
- `UnmarshalException`;
- `PropertyException`.

## 34.2 Include context

Log:

- partner/system;
- file name;
- schema version;
- root element;
- line/column if available;
- correlation ID;
- message ID;
- operation.

## 34.3 Do not log full XML blindly

XML may contain PII/secrets.

Log safely/sampled/redacted.

## 34.4 Validation location

Use `ValidationEventLocator` for line/column.

## 34.5 Malformed XML

Parser errors may occur before JAXB object creation.

## 34.6 Unknown element

Could be schema evolution issue.

## 34.7 Namespace mismatch

Log expected/found namespace.

## 34.8 Partner error report

Return structured report:

```text
file rejected
schema version
line
column
error code
human message
```

## 34.9 Retry

Do not retry deterministic XML validation failure.

Retry only transient IO/system failures.

---

# 35. Versioning dan Schema Evolution

XML contracts live long.

## 35.1 Namespace versioning

Example:

```text
https://example.com/customer/v1
https://example.com/customer/v2
```

## 35.2 Element optionality

Adding optional element is usually backward-compatible.

Removing/renaming required element is breaking.

## 35.3 Strict vs tolerant reading

Decide whether unknown elements fail.

For regulated integration, strict validation often needed.

## 35.4 Multiple schema versions

Support:

```text
v1 parser
v2 parser
```

or transform v1/v2 to canonical internal model.

## 35.5 Contract tests

Keep sample XML per version.

## 35.6 Golden files

Use golden XML files to detect accidental output changes.

## 35.7 Schema registry

For many partners/schemas, maintain catalog.

## 35.8 Deprecation policy

Communicate partner migration timeline.

---

# 36. Interoperability: SOAP, SFTP/XML Files, Government/Banking Integration

## 36.1 SOAP payloads

JAXB is often used by SOAP stacks to bind XML payload to Java objects.

## 36.2 SFTP/XML file exchange

Common flow:

```text
receive XML file
  ↓ validate signature/checksum
  ↓ secure parse
  ↓ schema validate
  ↓ unmarshal to XML DTO
  ↓ map to domain command
  ↓ process
  ↓ generate response XML
  ↓ marshal
  ↓ sign/encrypt/upload
```

## 36.3 Government integrations

Often schema-first, strict namespace/version requirements.

## 36.4 Banking/finance

Precision, validation, audit, and non-repudiation matter.

## 36.5 XML Signature

Do not marshal after signing unless you know canonicalization rules.

## 36.6 PGP/SFTP

XML binding is one part of larger integration pipeline.

## 36.7 Audit

Store:

- original file hash;
- schema version;
- validation result;
- processing result;
- generated response hash;
- correlation ID.

## 36.8 Idempotency

File/message ID must prevent duplicate processing.

---

# 37. Migration: `javax.xml.bind` → `jakarta.xml.bind`

## 37.1 Package rename

Old:

```java
javax.xml.bind.*
javax.xml.bind.annotation.*
javax.xml.bind.annotation.adapters.*
```

New:

```java
jakarta.xml.bind.*
jakarta.xml.bind.annotation.*
jakarta.xml.bind.annotation.adapters.*
```

## 37.2 Maven rename

Old:

```xml
<groupId>javax.xml.bind</groupId>
<artifactId>jaxb-api</artifactId>
```

New:

```xml
<groupId>jakarta.xml.bind</groupId>
<artifactId>jakarta.xml.bind-api</artifactId>
```

## 37.3 Implementation update

Use Jakarta-compatible runtime, e.g. JAXB RI 4.x.

## 37.4 Generated code

Regenerate XJC classes with Jakarta annotations.

Old generated code imports `javax.xml.bind.annotation`.

New generated code imports `jakarta.xml.bind.annotation`.

## 37.5 Mixed world problem

If your app has both old and new generated classes, they are not compatible.

## 37.6 SOAP stacks

If using SOAP/JAX-WS, align all related specs:

- XML Binding;
- XML Web Services;
- SOAP with Attachments;
- Activation;
- WS metadata;
- runtime.

## 37.7 Automation

Tools like OpenRewrite can help package/dependency migration, but generated code and runtime tests still required.

## 37.8 Test migration

- marshal old sample;
- unmarshal old sample;
- compare XML output;
- validate schema;
- test namespaces;
- test adapters;
- test SOAP/file integration.

---

# 38. Java 11+ dan JAXB Hilang dari JDK

In Java 8, many apps used JAXB from JDK.

In Java 11+, JAXB is no longer in Java SE.

## 38.1 Common error

```text
java.lang.NoClassDefFoundError: javax/xml/bind/JAXBException
```

or with Jakarta:

```text
ClassNotFoundException: jakarta.xml.bind.JAXBContext
```

## 38.2 Fix

Add explicit API + implementation dependencies.

## 38.3 Namespace matters

If code imports `javax.xml.bind`, adding `jakarta.xml.bind-api` will not fix compile errors.

Need migrate imports or use old JAXB API intentionally.

## 38.4 Java 21 projects

For modern Java:

- prefer Jakarta namespace for Jakarta ecosystem;
- ensure all transitive libraries compatible;
- avoid mixing old/new.

## 38.5 Spring/Jackson edge

Some libraries use JAXB annotations for compatibility.

Check whether they expect `javax` or `jakarta` annotation module.

## 38.6 Runtime image

If building custom runtime image, include required modules/dependencies.

---

# 39. Testing Strategy

## 39.1 Round-trip test

```text
Java object → XML → Java object
```

Assert semantic equality.

## 39.2 Golden XML test

Compare generated XML against approved file.

Normalize if formatting irrelevant.

## 39.3 Schema validation test

Validate outgoing XML.

Validate incoming sample XML.

## 39.4 Negative tests

- invalid namespace;
- missing required element;
- wrong type;
- unexpected element;
- nil vs missing;
- invalid enum;
- malformed XML.

## 39.5 Security tests

- XXE payload;
- entity expansion;
- external schema reference;
- huge XML;
- deeply nested XML.

## 39.6 Large file test

Use realistic large XML.

Measure memory.

## 39.7 Compatibility tests

Run partner sample files.

## 39.8 Migration tests

Old XML samples must still parse after migration.

## 39.9 Adapter tests

Test adapters independently.

## 39.10 Contract tests

If schema-first, generated classes and schema samples should be part of CI.

---

# 40. Observability dan Operational Runbook

## 40.1 Log metadata

For each XML processing job:

- partner;
- document type;
- schema version;
- file size;
- checksum;
- root QName;
- processing duration;
- validation result;
- record count;
- correlation ID.

## 40.2 Metrics

- XML files received;
- validation failures;
- unmarshal failures;
- marshal failures;
- processing duration;
- payload size distribution;
- schema version distribution;
- security rejection count;
- duplicate file count.

## 40.3 Tracing

Trace integration pipeline:

```text
receive → decrypt → validate → unmarshal → process → marshal → sign → send
```

## 40.4 Safe payload capture

Store original XML securely if required for audit.

Mask PII in logs.

## 40.5 Runbook

For failure, answer:

1. Which file/message?
2. Which schema?
3. Which line/column?
4. Partner issue or our issue?
5. Can retry?
6. Duplicate?
7. Is file quarantined?
8. Response sent?

## 40.6 Dead letter/quarantine

Invalid XML should go to quarantine with reason.

## 40.7 Replay

Design safe replay with idempotency.

---

# 41. Production Failure Modes

## 41.1 Missing implementation

API jar present but no runtime implementation.

Error during `JAXBContext.newInstance`.

## 41.2 Javax/Jakarta mismatch

Generated code imports `javax`, app uses `jakarta`.

## 41.3 Missing no-arg constructor

Unmarshaller cannot instantiate class.

## 41.4 Missing `@XmlRootElement`

Marshaller cannot marshal object as root.

Use `JAXBElement`.

## 41.5 Namespace mismatch

Expected namespace differs from input.

## 41.6 Validation not enabled

Invalid XML silently accepted until downstream error.

## 41.7 XXE/SSRF

Parser loads external entity/schema.

## 41.8 Heap explosion

Whole huge XML unmarshalled into object graph.

## 41.9 N+1 during marshal

JPA entity graph triggers lazy loading.

## 41.10 Wrong date timezone

`dateTime` interpreted differently.

## 41.11 Output order mismatch

Partner schema requires order, `propOrder` missing.

## 41.12 Prefix mismatch

Partner expects specific prefix or signed XML canonicalization issue.

## 41.13 Transitive dependency conflict

Old JAXB runtime wins classpath.

## 41.14 Silent partial validation continue

Event handler returns true and bad object graph proceeds.

---

# 42. Best Practices dan Anti-Patterns

## 42.1 Best practices

- Treat XML as boundary contract.
- Use XML DTOs, not domain/JPA entities.
- Cache `JAXBContext`.
- Create marshaller/unmarshaller per operation.
- Validate against XSD for external contracts.
- Secure XML parser configuration.
- Use StAX/streaming for huge XML.
- Use `XmlAdapter` for modern Java types.
- Version schemas explicitly.
- Test with partner samples/golden files.
- Log line/column safely.
- Add explicit dependencies on Java 11+/Jakarta EE 11.
- Avoid mixing `javax` and `jakarta`.

## 42.2 Anti-pattern: Bind JPA entity directly

Can leak fields, trigger lazy loading, and couple DB/domain to XML.

## 42.3 Anti-pattern: No schema validation

Invalid partner files fail later in business logic.

## 42.4 Anti-pattern: Default parser for untrusted XML

Security risk.

## 42.5 Anti-pattern: `JAXBContext` per request

Performance issue.

## 42.6 Anti-pattern: Whole huge XML unmarshal

Heap issue.

## 42.7 Anti-pattern: Editing generated XJC code

Customize generation instead.

## 42.8 Anti-pattern: Trusting `required=true` as runtime validation

Enable schema validation.

---

# 43. Checklist Review

## 43.1 Dependency/runtime

- [ ] API dependency present?
- [ ] Implementation dependency present?
- [ ] No `javax`/`jakarta` mismatch?
- [ ] Runtime classpath clean?
- [ ] Java 11+ dependency explicit?
- [ ] Jakarta EE 11 removal accounted for?

## 43.2 Binding design

- [ ] XML DTO separate from domain?
- [ ] Namespace correct?
- [ ] Root element defined?
- [ ] `propOrder` correct?
- [ ] Collections wrapper intentional?
- [ ] Null/nil semantics defined?
- [ ] Adapters tested?

## 43.3 Security

- [ ] DTD disabled?
- [ ] External entities disabled?
- [ ] External schema access restricted?
- [ ] Size limits?
- [ ] Depth limits if available?
- [ ] Payload logging redacted?

## 43.4 Validation

- [ ] XSD validation enabled for external XML?
- [ ] Event handler stops on error?
- [ ] Line/column logged?
- [ ] Partner error report structured?

## 43.5 Performance

- [ ] `JAXBContext` cached?
- [ ] Streaming used for large XML?
- [ ] Schema cached?
- [ ] No JPA lazy loading during marshal?
- [ ] Memory tested with realistic files?

## 43.6 Operations

- [ ] File/message checksum?
- [ ] Idempotency key?
- [ ] Quarantine invalid files?
- [ ] Replay mechanism?
- [ ] Metrics and alerts?

---

# 44. Case Study 1: XML File Exchange dengan External Agency

## 44.1 Requirement

Agency sends daily XML file via SFTP.

System must import applications.

## 44.2 Architecture

```text
SFTP receive
  ↓ verify filename/checksum
  ↓ secure parser
  ↓ XSD validation
  ↓ StAX stream each <application>
  ↓ JAXB unmarshal per record
  ↓ map to domain command
  ↓ process idempotently
  ↓ generate response XML
  ↓ marshal + validate
  ↓ upload response
```

## 44.3 Why not whole-file unmarshal?

File may contain hundreds of thousands of records.

## 44.4 Error handling

- invalid XML structure → reject file;
- invalid record → depending contract, reject file or record-level report;
- duplicate record → idempotent skip/report.

## 44.5 Audit

Store original file hash, schema version, processing result.

## 44.6 Lesson

JAXB is one tool inside integration pipeline, not the entire pipeline.

---

# 45. Case Study 2: Migrasi Java 8 JAXB ke Java 21 Jakarta XML Binding

## 45.1 Initial state

App on Java 8 uses:

```java
javax.xml.bind.JAXBContext
```

No explicit JAXB dependency because JDK provides it.

## 45.2 Upgrade to Java 21

Fails:

```text
package javax.xml.bind does not exist
```

or runtime class not found.

## 45.3 Migration paths

Option A: stay on `javax` with explicit old dependencies.

Option B: migrate to `jakarta.xml.bind`.

For Jakarta EE modern stack, choose B if dependencies support it.

## 45.4 Steps

1. Update imports.
2. Update API dependency.
3. Add JAXB runtime.
4. Regenerate XJC classes.
5. Update binding files if namespace changed.
6. Test golden XML.
7. Test partner samples.
8. Check transitive libraries.

## 45.5 Pitfall

A library still expects `javax.xml.bind.annotation`.

Need compatibility version or migration.

## 45.6 Lesson

Java upgrade and Jakarta namespace migration are related but distinct tasks.

---

# 46. Case Study 3: XXE dari XML Partner yang Tidak Diproteksi

## 46.1 Problem

Partner XML contains external entity.

Parser resolves it.

## 46.2 Impact

Potential:

- local file read;
- SSRF;
- resource exhaustion.

## 46.3 Root cause

Untrusted XML parsed with default parser configuration.

## 46.4 Fix

Use secure parser settings:

- disable DTD;
- disable external entities;
- restrict external schema;
- size limit;
- validate schema from trusted local copy.

## 46.5 Test

Add malicious XML test in CI.

## 46.6 Lesson

XML parsing security is mandatory, not optional.

---

# 47. Case Study 4: Huge XML Membuat Heap Meledak

## 47.1 Problem

Incoming XML 3 GB.

App does:

```java
Root root = (Root) unmarshaller.unmarshal(file);
```

Heap OOM.

## 47.2 Root cause

Whole document object graph created.

## 47.3 Fix

Use StAX:

```text
read stream
when <record>
  unmarshal one record
  process
  discard
```

## 47.4 Add batch

Process records in DB batches.

## 47.5 Add checkpoint

For restartability.

## 47.6 Lesson

Binding whole document is not scalable for huge XML.

---

# 48. Latihan Bertahap

## Latihan 1 — Basic marshal

Create `CustomerXml` and marshal to XML.

## Latihan 2 — Basic unmarshal

Read XML into `CustomerXml`.

## Latihan 3 — Namespace

Add namespace using `package-info.java`.

## Latihan 4 — Attribute vs element

Map ID as attribute, fields as elements.

## Latihan 5 — List wrapper

Use `@XmlElementWrapper`.

## Latihan 6 — XmlAdapter

Map `LocalDate` to string.

## Latihan 7 — Schema validation

Validate incoming XML against XSD.

## Latihan 8 — JAXBElement

Marshal class without `@XmlRootElement`.

## Latihan 9 — Secure parser

Test XXE payload and ensure blocked.

## Latihan 10 — Large XML streaming

Use StAX + JAXB to unmarshal record-by-record.

---

# 49. Mini Project: Jakarta XML Binding Production Lab

## 49.1 Goal

Create:

```text
jakarta-xml-binding-production-lab/
```

## 49.2 Modules

```text
basic-marshal/
basic-unmarshal/
namespace/
schema-first-xjc/
code-first-schemagen/
xml-adapter/
schema-validation/
secure-parser/
large-xml-streaming/
migration-javax-to-jakarta/
```

## 49.3 Deliverables

```text
README.md
XML-BINDING-MENTAL-MODEL.md
SCHEMA-FIRST.md
CODE-FIRST.md
NAMESPACE.md
VALIDATION.md
SECURITY.md
LARGE-XML.md
MIGRATION.md
FAILURE-MODES.md
```

## 49.4 Required experiments

1. Marshal object to XML.
2. Unmarshal XML to object.
3. Validate with XSD.
4. Use namespace/package-info.
5. Generate Java from XSD.
6. Generate XSD from Java.
7. Use `XmlAdapter` for `LocalDate`.
8. Block XXE payload.
9. Stream huge XML records.
10. Migrate `javax` sample to `jakarta`.

## 49.5 Evaluation questions

1. What is `JAXBContext`?
2. Difference marshalling and unmarshalling?
3. Why cache `JAXBContext`?
4. Why is `Marshaller` not shared concurrently?
5. What is `JAXBElement`?
6. What is namespace URI vs prefix?
7. Why use XML DTO not domain entity?
8. Why enable schema validation?
9. What is XXE?
10. Why is whole-file JAXB bad for huge XML?

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta XML Binding 4.0  
   https://jakarta.ee/specifications/xml-binding/4.0/

2. Jakarta XML Binding 4.0 Specification  
   https://jakarta.ee/specifications/xml-binding/4.0/jakarta-xml-binding-spec-4.0

3. Jakarta XML Binding API Docs  
   https://jakarta.ee/specifications/xml-binding/4.0/apidocs/

4. API Docs — package `jakarta.xml.bind`  
   https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/package-summary

5. API Docs — `JAXBContext`  
   https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/jaxbcontext

6. API Docs — `Unmarshaller`  
   https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/unmarshaller

7. Eclipse Implementation of JAXB  
   https://eclipse-ee4j.github.io/jaxb-ri/

8. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

9. Jakarta EE Platform 11 Specification  
   https://jakarta.ee/specifications/platform/11/jakarta-platform-spec-11.0.pdf

10. Jakarta XML Binding Specifications Overview  
    https://jakarta.ee/specifications/xml-binding/

---

# Penutup

Jakarta XML Binding / JAXB adalah framework untuk memetakan XML document dan Java object graph.

Mental model ringkas:

```text
JAXBContext:
  binding metadata runtime

Marshaller:
  Java object → XML

Unmarshaller:
  XML → Java object

Annotations:
  define mapping

XSD:
  contract/validation

XmlAdapter:
  bridge XML-friendly type and Java-friendly type
```

Namun konteks modern penting:

```text
Jakarta XML Binding 4.0 adalah standalone spec modern.
Jakarta EE 11 Platform tidak lagi mewajibkan XML Binding.
Java 11+ tidak lagi membawa JAXB dari JDK.
```

Jadi gunakan dependency eksplisit.

Prinsip paling penting:

```text
XML binding belongs at integration boundaries.
Protect your domain model, validate your contracts, and secure your XML parser.
```

Engineer top-tier tidak hanya bisa `JAXB.marshal`. Ia tahu namespace, XSD, adapters, `JAXBElement`, schema validation, XXE, streaming large XML, Java/Jakarta namespace migration, dependency/runtime split, dan bagaimana membuat XML integration aman, observable, dan evolvable.

Bagian berikutnya akan membahas **Jakarta XML Web Services (`jakarta.xml.ws`) / JAX-WS**: SOAP service/client model, WSDL-first vs code-first, JAXB payload binding, handlers, faults, MTOM, WS-Security ecosystem, migration, and why SOAP/XML Web Services are legacy-but-still-important.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-030.md](./learn-java-jakarta-part-030.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-032.md](./learn-java-jakarta-part-032.md)
