# Strict Coding Standards — Java XML

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when parsing, generating, transforming, validating, binding, storing, or transmitting XML in Java.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. Covers JAXP, DOM, SAX, StAX, XPath, XSLT, XSD validation, JAXB/Jakarta XML Binding, XML signatures/encryption boundaries, file/network XML ingestion, and XML security.
>
> **Mode**: Strict. XML processing is security-sensitive by default.

---

## 0. Core Principle

XML is not plain text. XML parsers can load external resources, expand entities, resolve DTDs, process schemas, run transformations, and consume large memory/CPU through nested structures.

Therefore, every XML implementation must be secure-by-default, bounded, schema-aware when required, and explicit about trust boundaries.

A code agent must never create an XML parser with default settings for untrusted input.

---

## 1. Version and Namespace Matrix

| Area                                                                  |                  Java 11 |             Java 17 |             Java 21 |             Java 25 | Rule                                               |
| --------------------------------------------------------------------- | -----------------------: | ------------------: | ------------------: | ------------------: | -------------------------------------------------- |
| JAXP (`javax.xml.parsers`, `javax.xml.stream`, `javax.xml.transform`) |                      Yes |                 Yes |                 Yes |                 Yes | Allowed with secure config                         |
| DOM                                                                   |                      Yes |                 Yes |                 Yes |                 Yes | Restricted; not for large XML                      |
| SAX                                                                   |                      Yes |                 Yes |                 Yes |                 Yes | Allowed for streaming parse                        |
| StAX                                                                  |                      Yes |                 Yes |                 Yes |                 Yes | Preferred for pull streaming                       |
| XPath                                                                 |                      Yes |                 Yes |                 Yes |                 Yes | Restricted; no user-controlled expressions         |
| XSLT                                                                  |                      Yes |                 Yes |                 Yes |                 Yes | Restricted; no untrusted stylesheets               |
| XSD validation                                                        |                      Yes |                 Yes |                 Yes |                 Yes | Allowed with secure resolver                       |
| JAXB in JDK                                                           | Removed from Java 11 JDK |             Removed |             Removed |             Removed | Use explicit dependency only                       |
| Jakarta XML Binding                                                   |      External dependency | External dependency | External dependency | External dependency | Do not mix `javax.xml.bind` and `jakarta.xml.bind` |

### 1.1 Namespace Rule

Do not mix JAXB legacy and Jakarta XML Binding namespaces in the same module unless it is a migration bridge.

- Legacy JAXB: `javax.xml.bind.*`
- Jakarta XML Binding: `jakarta.xml.bind.*`

A project must pick one binding namespace per module.

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

The following are forbidden unless explicitly approved:

1. parsing XML from untrusted input with default parser configuration;
2. allowing DTDs for untrusted XML;
3. allowing external general entities;
4. allowing external parameter entities;
5. allowing external schema loading from arbitrary URLs;
6. allowing external stylesheet loading from arbitrary URLs;
7. processing XInclude for untrusted XML;
8. resolving network resources during XML parsing unless allow-listed;
9. using DOM for large or unbounded XML;
10. reading full XML input into `String` before parsing for large payloads;
11. using XPath expressions constructed from user input;
12. using XSLT stylesheets supplied by users;
13. JAXB-unmarshalling untrusted XML without a securely configured parser/source;
14. logging full XML payloads containing PII/secrets;
15. converting XML parse failures into generic `500` without stable error mapping;
16. ignoring parser limits for entity expansion, element depth, total size, and node count.

### 2.2 Mandatory for XML Ingestion

Every XML ingestion path must define:

```text
XML Ingestion Policy
- Input source:
- Trust level:
- Max byte size:
- Parser type:
- DTD policy:
- External entity policy:
- External resource resolver:
- Schema validation policy:
- Namespace policy:
- Error mapping:
- Logging/redaction:
- Tests:
```

---

## 3. XML Parser Decision Matrix

| Use case                    | Preferred API                                    | Avoid                                  |
| --------------------------- | ------------------------------------------------ | -------------------------------------- |
| Small trusted config file   | DOM with secure config                           | default parser                         |
| Large document streaming    | StAX or SAX                                      | DOM                                    |
| Event-driven extraction     | SAX                                              | loading entire document                |
| Pull-based business parsing | StAX                                             | ad-hoc string parsing                  |
| XML to DTO binding          | JAXB/Jakarta XML Binding with secure source      | direct unmarshal from untrusted stream |
| Transform XML               | XSLT with trusted stylesheet and secure resolver | user-supplied stylesheet               |
| Validate XML                | XSD with local allow-listed schemas              | external schema URL resolution         |
| Query XML                   | XPath with fixed expressions                     | user-built XPath string                |

---

## 4. Secure Defaults for JAXP

### 4.1 Required Security Settings

For untrusted XML, parsers must disable or restrict:

1. DTD processing;
2. external general entities;
3. external parameter entities;
4. external DTD/schema access;
5. XInclude;
6. entity expansion;
7. unbounded depth/size;
8. network resource resolution.

### 4.2 `DocumentBuilderFactory` Rule

DOM is restricted. Use only for small bounded documents.

Required pattern:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setNamespaceAware(true);
factory.setXIncludeAware(false);
factory.setExpandEntityReferences(false);
factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true);
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

DocumentBuilder builder = factory.newDocumentBuilder();
builder.setEntityResolver((publicId, systemId) -> new org.xml.sax.InputSource(new java.io.StringReader("")));
Document document = builder.parse(inputStream);
```

Rules:

1. Parser factory creation must be centralized.
2. Parser features must not be scattered across business code.
3. Unsupported feature handling must fail closed or be explicitly documented.
4. Tests must prove XXE payloads fail.

### 4.3 `SAXParserFactory` Rule

SAX is preferred for streaming event extraction.

Required:

```java
SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setNamespaceAware(true);
factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true);
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
```

SAX handlers must not store unbounded text or element stacks.

### 4.4 `XMLInputFactory` Rule

StAX is preferred for pull parsing.

Required:

```java
XMLInputFactory factory = XMLInputFactory.newFactory();
factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
factory.setProperty(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
```

Rules:

1. Do not call `getElementText()` on unbounded elements without size limit.
2. Limit total events processed.
3. Validate expected element sequence.
4. Do not ignore namespaces.
5. Close readers/input streams.

---

## 5. XML Size and Resource Limits

Every untrusted XML path must enforce:

1. maximum bytes before parser;
2. maximum decompressed size if compressed;
3. maximum element depth;
4. maximum number of elements;
5. maximum text node length;
6. maximum attribute count;
7. maximum attribute value length;
8. maximum processing time or request timeout;
9. maximum output size for transformations;
10. schema validation time/resource bound.

Reject payload before parsing if body size exceeds configured limit.

---

## 6. DTD and Entity Policy

### 6.1 Default Policy

DTD is disabled for untrusted XML.

Allowed only for trusted local/internal XML where:

1. DTD file is bundled locally;
2. resolver allow-lists the resource;
3. no network resolution occurs;
4. expansion limits are configured;
5. tests cover malicious entity expansion.

### 6.2 XXE Defense

XML External Entity defense must be tested with payloads that attempt:

1. local file read;
2. internal network access;
3. HTTP callback;
4. external parameter entity;
5. billion laughs/entity expansion;
6. external schema import;
7. external stylesheet import.

---

## 7. Namespace Handling

Namespaces must be explicit.

Rules:

1. `namespaceAware` must be true for standards-based XML.
2. Do not compare only local element names when namespaces matter.
3. Do not strip namespaces unless the input contract says namespaces are irrelevant.
4. XPath must use explicit namespace context.
5. Generated XML must declare namespaces deterministically.

Forbidden:

```java
if (node.getNodeName().equals("Amount")) { ... }
```

Preferred:

```java
if ("urn:company:payment:v1".equals(node.getNamespaceURI())
        && "Amount".equals(node.getLocalName())) {
    ...
}
```

---

## 8. XML Schema Validation

XSD validation is allowed when schema is trusted and controlled.

Rules:

1. Use local packaged schema resources.
2. Disable external schema access unless allow-listed.
3. Do not load schema from user-supplied URL.
4. Version schemas explicitly.
5. Separate syntax validation from business validation.
6. Map validation errors to stable error codes.
7. Do not leak internal file paths in validation errors.
8. Validate before business processing if schema is part of contract.

Required pattern:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
Schema schema = schemaFactory.newSchema(localSchemaUrl);
Validator validator = schema.newValidator();
validator.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
validator.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
validator.validate(source);
```

---

## 9. XPath Rules

XPath is restricted.

Allowed:

1. fixed expressions owned by code;
2. namespace-aware evaluation;
3. bounded document size;
4. read-only extraction.

Forbidden:

1. concatenating user input into XPath;
2. allowing arbitrary XPath from request/config/database;
3. using XPath as authorization logic without explicit model;
4. XPath over large DOM documents in hot path;
5. ignoring namespace context.

If user selects a field, map user choice to a fixed expression:

```java
private static final Map<String, String> PATHS = Map.of(
    "customerId", "/ns:Order/ns:Customer/ns:Id/text()",
    "amount", "/ns:Order/ns:Amount/text()"
);
```

---

## 10. XSLT Rules

XSLT is high risk.

Allowed only when:

1. stylesheet is trusted and packaged;
2. external document/function access is disabled;
3. output size is bounded;
4. transformation time is bounded;
5. error handling is deterministic;
6. tests cover external resource attempts.

Forbidden:

1. user-supplied stylesheet;
2. stylesheet from URL;
3. dynamic extension functions unless approved;
4. writing transform output to arbitrary path;
5. logging entire transform input/output if sensitive.

Required:

```java
TransformerFactory factory = TransformerFactory.newInstance();
factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
```

---

## 11. JAXB / Jakarta XML Binding Rules

### 11.1 Binding Namespace

Pick one namespace per module:

- `javax.xml.bind` for legacy stacks;
- `jakarta.xml.bind` for Jakarta stacks.

Do not mix in the same module.

### 11.2 Unmarshal Safety

For untrusted XML, do not call unmarshal directly on `File`, `InputStream`, or `Reader` unless the underlying XML reader/parser is securely configured.

Forbidden:

```java
Order order = (Order) unmarshaller.unmarshal(inputStream);
```

Preferred:

```java
XMLInputFactory xif = XmlFactories.secureXmlInputFactory();
XMLStreamReader xsr = xif.createXMLStreamReader(inputStream);
Order order = unmarshaller.unmarshal(xsr, Order.class).getValue();
```

Rules:

1. DTO classes only; no direct domain entity binding.
2. Validate DTO after unmarshal.
3. Unknown element policy must be explicit.
4. Polymorphism must be restricted.
5. Adapter classes must be deterministic and tested.
6. Sensitive fields must not be serialized accidentally.
7. Schema version must be explicit for external contracts.

---

## 12. XML Generation Rules

Generated XML must be deterministic and escaped by XML APIs, not manual string concatenation.

Forbidden:

```java
return "<name>" + name + "</name>";
```

Preferred:

1. StAX writer;
2. DOM builder for small documents;
3. JAXB/Jakarta XML Binding for explicit DTOs;
4. template engine only if XML escaping is guaranteed and tested.

Rules:

1. Always specify encoding, usually UTF-8.
2. Escape text/attribute values with XML writer APIs.
3. Do not manually escape with ad-hoc replace chains.
4. Preserve namespace contract.
5. Include XML declaration only when required by integration contract.
6. Sort deterministic elements when output order matters.
7. Do not include secrets unless contract explicitly requires it.

---

## 13. XML and File/Network Boundary

### 13.1 File Input

Rules:

1. Resolve path against approved base directory.
2. Block path traversal.
3. Enforce max file size before parsing.
4. Do not follow symlinks unless approved.
5. Use try-with-resources.
6. Do not parse files dropped by users without scan/validation pipeline.

### 13.2 Network Input

Rules:

1. Enforce HTTP size limits.
2. Enforce content type if applicable.
3. Do not trust content type alone.
4. Disable parser network fetching.
5. Apply timeout and cancellation.
6. Log only metadata, not full body by default.

---

## 14. XML Signature and Encryption Boundary

XML Signature and XML Encryption are specialized security protocols.

Rules:

1. Do not implement custom XML canonicalization.
2. Do not hand-roll signature verification.
3. Validate certificate/key trust separately from XML parsing.
4. Prevent signature wrapping attacks by validating ID/reference semantics.
5. Verify what was signed, not merely that something is signed.
6. Do not treat encrypted XML as trusted after decryption; still validate.
7. Use vetted libraries and security review.

Any XML signature implementation requires an architecture security note.

---

## 15. Error Handling

XML errors must be deterministic.

Rules:

1. Distinguish malformed XML, schema-invalid XML, unsupported version, disallowed external entity, oversized payload, and business validation failure.
2. Do not return parser stack traces to API clients.
3. Include correlation ID in logs.
4. Redact payload fragments.
5. Preserve parser exception internally.
6. Fail closed on unsupported parser feature when security depends on it.

Error model example:

```text
XML_PARSE_ERROR
XML_SCHEMA_VALIDATION_ERROR
XML_UNSUPPORTED_VERSION
XML_EXTERNAL_ENTITY_REJECTED
XML_SIZE_LIMIT_EXCEEDED
XML_BUSINESS_VALIDATION_ERROR
```

---

## 16. Observability

Log/metric:

1. parser type;
2. payload size bucket;
3. schema version;
4. parse duration;
5. validation duration;
6. rejection reason;
7. external entity rejection count;
8. transformation duration;
9. source system;
10. correlation ID.

Do not log:

1. full XML payload by default;
2. passwords, tokens, secrets;
3. PII without redaction;
4. file paths from internal systems to external clients;
5. certificate private material.

---

## 17. Testing Requirements

Mandatory tests for XML input:

1. valid minimal XML;
2. valid maximal-size XML;
3. malformed XML;
4. unsupported namespace;
5. unsupported schema version;
6. missing required element;
7. unknown element behavior;
8. XXE local file payload;
9. XXE network payload;
10. external parameter entity payload;
11. billion laughs/entity expansion payload;
12. oversized element text;
13. excessive nesting;
14. schema import attempt;
15. XSLT external resource attempt if XSLT is used.

Mandatory tests for XML output:

1. correct encoding;
2. correct namespace;
3. escaping text/attribute values;
4. deterministic output;
5. no secret leakage;
6. schema-valid generated XML if schema exists.

---

## 18. Review Checklist

A reviewer must reject XML code if:

- [ ] Parser default settings are used for untrusted input.
- [ ] DTD/external entities are not disabled or constrained.
- [ ] External resource access policy is missing.
- [ ] Payload size/depth limits are missing.
- [ ] DOM is used for large/unbounded input.
- [ ] XPath is built from user input.
- [ ] XSLT stylesheet is user supplied.
- [ ] JAXB unmarshal bypasses secure parser/source.
- [ ] XML output is built by string concatenation.
- [ ] Namespace handling is ambiguous.
- [ ] Schema loading can reach arbitrary network locations.
- [ ] Full XML payload is logged without redaction.
- [ ] XXE/entity expansion tests are missing.

---

## 19. LLM Code Agent Contract

```text
You are implementing Java XML code.
You must treat XML input as untrusted unless explicitly stated otherwise.
You must not create default XML parsers for untrusted input.
You must disable DTDs and external entities by default.
You must block external DTD/schema/stylesheet access unless allow-listed.
You must enforce size/depth/time limits.
You must not build XML with string concatenation.
You must not use user-controlled XPath or XSLT.
You must not directly JAXB-unmarshal untrusted streams without a secure parser/source.
You must add tests for XXE, entity expansion, malformed XML, schema invalid XML, and oversized XML.
```

---

## 20. References

- Oracle JAXP Security Guide: https://docs.oracle.com/en/java/javase/24/security/java-api-xml-processing-jaxp-security-guide.html
- Oracle Java 11 JAXP Security Guide: https://docs.oracle.com/en/java/javase/11/security/java-api-xml-processing-jaxp-security-guide.html
- OWASP XML External Entity Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- Java `DocumentBuilderFactory`: https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/parsers/DocumentBuilderFactory.html
- Java `XMLInputFactory`: https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/stream/XMLInputFactory.html
- Java `TransformerFactory`: https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/transform/TransformerFactory.html
- Java XML Constants: https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/XMLConstants.html
