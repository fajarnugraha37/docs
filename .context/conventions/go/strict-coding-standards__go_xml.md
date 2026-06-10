# Strict Coding Standards — Go XML

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, integration adapters, SOAP/XML APIs, file importers/exporters, regulatory submissions, archival documents, config parsers  
Baseline: Go 1.24–1.26+, `encoding/xml`, security-first parsing, explicit contract mapping

---

## 1. Purpose

XML is a structured document format with namespaces, attributes, mixed content, entities, character encodings, and security-sensitive parser behavior.

The LLM MUST NOT treat XML as “JSON with angle brackets”. XML handling MUST be explicit about schema, namespace, size, streaming, entities, character set, canonical output, and boundary mapping.

XML implementation MUST answer these questions before code is written:

1. Is this XML inbound, outbound, archival, config, SOAP, regulatory submission, or external integration?
2. Is the schema known and versioned?
3. Are namespaces significant?
4. Are unknown elements/attributes rejected, ignored, or preserved?
5. Is the document size bounded?
6. Is streaming required?
7. Are external entities, custom entities, or non-UTF encodings allowed?
8. Does output require canonical ordering, signature stability, or regulatory reproducibility?

---

## 2. Source authority

Primary references:

- Go `encoding/xml` package documentation: https://pkg.go.dev/encoding/xml
- Go `io` package documentation: https://pkg.go.dev/io
- Go `net/http` package documentation: https://pkg.go.dev/net/http
- Go `unicode/utf8` package documentation: https://pkg.go.dev/unicode/utf8
- Go `time` package documentation: https://pkg.go.dev/time
- Go fuzzing documentation: https://go.dev/doc/security/fuzz
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments

If this document conflicts with an explicit XML Schema, WSDL, partner integration document, or regulatory submission specification, the explicit contract wins, but the LLM MUST report the conflict.

---

## 3. XML boundary taxonomy

The LLM MUST classify the XML boundary before implementation.

| Boundary                | Main risk                                                  | Required posture                  |
| ----------------------- | ---------------------------------------------------------- | --------------------------------- |
| Public inbound XML      | malformed input, oversized payload, malicious entity usage | strict, bounded, defensive        |
| Partner integration XML | schema drift, namespace mismatch, charset mismatch         | contract-first, version-aware     |
| SOAP                    | envelope/body/header mapping, fault handling               | explicit envelope model           |
| Regulatory submission   | reproducibility, auditability, exact field semantics       | canonical contract, golden tests  |
| Archival XML            | long-term compatibility                                    | schema version and migration path |
| Config XML              | unsafe defaults                                            | strict unknown-element policy     |
| Export XML              | client compatibility                                       | stable ordering and namespaces    |
| Signed XML              | canonicalization and signature safety                      | do not mutate signed content      |

---

## 4. Non-negotiable rules

### 4.1 Do not parse untrusted XML without a size limit

The LLM MUST bound all untrusted XML input before decoding.

Required for HTTP:

```go
const maxXMLBytes = 2 << 20 // choose per endpoint
r.Body = http.MaxBytesReader(w, r.Body, maxXMLBytes)
dec := xml.NewDecoder(r.Body)
```

For non-HTTP streams, use `io.LimitReader` or an equivalent bounded reader.

Forbidden:

```go
var req Request
_ = xml.NewDecoder(r.Body).Decode(&req) // unbounded
```

---

### 4.2 Do not decode XML directly into domain models

The LLM MUST use XML DTOs separate from domain models.

Required:

```go
type CaseSubmissionXML struct {
	XMLName   xml.Name `xml:"CaseSubmission"`
	CaseID    string   `xml:"CaseID"`
	Submitted string   `xml:"SubmittedAt"`
}
```

Map explicitly into domain commands/value objects after syntactic parsing and validation.

Forbidden:

```go
var c domain.Case
xml.NewDecoder(r.Body).Decode(&c)
```

---

### 4.3 Define namespace policy explicitly

The LLM MUST NOT ignore namespaces by accident.

Every XML contract with namespaces MUST define:

- expected namespace URI,
- allowed prefixes if required by partner/spec,
- element local names,
- attributes with namespaces,
- behavior for unknown namespace.

Use `xml.Name` when namespace matters:

```go
type Envelope struct {
	XMLName xml.Name `xml:"http://schemas.xmlsoap.org/soap/envelope/ Envelope"`
	Body    Body     `xml:"Body"`
}
```

Do not assume prefix equality is namespace equality.

---

### 4.4 Unknown element policy MUST be explicit

The LLM MUST define whether unknown elements and attributes are:

- rejected,
- ignored,
- preserved as raw extension content,
- accepted only in forward-compatible mode.

`encoding/xml` unmarshalling into structs may ignore data that does not map to fields. For strict contracts, the LLM MUST implement token-level validation or schema validation outside the standard library.

---

### 4.5 XML decode errors MUST NOT be ignored

The LLM MUST classify XML parse errors into caller-safe categories:

- malformed XML,
- unexpected root element,
- namespace mismatch,
- unsupported charset,
- unknown element/attribute,
- invalid value format,
- document too large,
- unsupported version/schema,
- semantic validation error.

---

## 5. Struct mapping rules

### 5.1 Always use explicit XML tags for wire structs

Every exported XML DTO field MUST have an explicit `xml` tag or be explicitly ignored with `xml:"-"`.

Required:

```go
type PersonXML struct {
	XMLName xml.Name `xml:"Person"`
	ID      string   `xml:"id,attr"`
	Name    string   `xml:"Name"`
}
```

Forbidden:

```go
type PersonXML struct {
	ID   string
	Name string
}
```

---

### 5.2 Root element MUST be validated

Inbound XML MUST validate the root element name and namespace.

Required:

```go
var req CaseSubmissionXML
if err := dec.Decode(&req); err != nil {
	return err
}
if req.XMLName.Local != "CaseSubmission" || req.XMLName.Space != expectedNamespace {
	return fmt.Errorf("unexpected root element")
}
```

---

### 5.3 Attributes and elements MUST not be interchanged casually

The LLM MUST follow the external contract for attribute vs element representation.

Example:

```go
type DocumentRefXML struct {
	ID   string `xml:"id,attr"`
	Type string `xml:"type,attr"`
	Name string `xml:"Name"`
}
```

Do not change element to attribute or attribute to element for aesthetics.

---

### 5.4 Mixed content MUST be modeled deliberately

XML may contain mixed text and child elements. The LLM MUST NOT flatten mixed content unless contract says so.

Use `,chardata`, `,innerxml`, or token streaming only with explicit justification.

Rules:

- `,innerxml` MUST be treated as unsafe raw content.
- Raw XML MUST not be logged or echoed without sanitization.
- Mixed content tests MUST include whitespace, nested elements, and entity references.

---

### 5.5 Optionality and empty elements MUST be tested

The LLM MUST distinguish:

| XML shape                        | Meaning may differ                      |
| -------------------------------- | --------------------------------------- |
| missing element                  | absent                                  |
| empty element `<Name/>`          | explicit empty                          |
| empty text `<Name></Name>`       | explicit empty                          |
| whitespace text `<Name> </Name>` | whitespace value or invalid             |
| `xsi:nil="true"`                 | explicit null in schema-aware contracts |

If `xsi:nil` is used, the DTO and mapper MUST handle it explicitly.

---

## 6. Security rules

### 6.1 External entity behavior MUST be denied unless explicitly required

The LLM MUST NOT implement custom entity expansion for untrusted XML unless a reviewed contract requires it.

Rules:

- Do not fetch external DTD/entity references during parse.
- Do not resolve file/network references from XML.
- Do not add custom entities without size and recursion controls.
- Treat raw XML and entity-expanded text as untrusted.

The standard `encoding/xml` decoder is not a full validating XML processor. Do not add “helpful” entity resolution unless security review approves it.

---

### 6.2 Bound nesting, token count, and text size for hostile input

For untrusted XML, byte limit alone may not be enough. The LLM SHOULD implement token-level guardrails for:

- maximum depth,
- maximum elements,
- maximum attributes per element,
- maximum text length,
- maximum total character data,
- maximum processing instructions if allowed.

Example streaming guard:

```go
func ValidateXMLShape(dec *xml.Decoder, maxDepth int) error {
	depth := 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		switch tok.(type) {
		case xml.StartElement:
			depth++
			if depth > maxDepth {
				return fmt.Errorf("xml depth exceeded")
			}
		case xml.EndElement:
			depth--
		}
	}
}
```

---

### 6.3 Charset handling MUST be explicit

XML documents may declare encodings other than UTF-8. If the service accepts non-UTF encodings, the LLM MUST configure `Decoder.CharsetReader` with an approved converter.

Rules:

- Reject unsupported encodings with a clear error.
- Do not silently misdecode bytes.
- Normalize text after decode only if the contract says so.
- Test with UTF-8 and each supported non-UTF charset.

---

### 6.4 Never trust XML-derived paths, URLs, SQL fragments, shell args, or templates

XML parsing does not sanitize values. The LLM MUST apply context-specific validation and escaping before using XML-derived values in:

- SQL,
- shell command,
- file path,
- URL,
- HTML,
- JSON,
- logs,
- regex,
- outbound XML.

---

## 7. Streaming rules

### 7.1 Use token streaming for large XML

The LLM MUST NOT load large XML documents into memory when token streaming is viable.

Use `Decoder.Token` for:

- large import files,
- repeating records,
- regulatory bulk submissions,
- archives,
- partial extraction,
- shape validation.

Forbidden:

```go
var doc HugeDocumentXML
xml.NewDecoder(r).Decode(&doc) // unbounded structure
```

---

### 7.2 Streaming parser MUST maintain path state

When parsing XML by tokens, the LLM MUST track element stack/path. Do not infer field meaning from local name alone if the same element name can appear in multiple places.

Required considerations:

- namespace URI,
- local name,
- parent path,
- attributes,
- mixed content,
- repeated elements,
- ordering constraints.

---

### 7.3 Partial processing MUST be transactional or resumable

If an XML import processes many records, the LLM MUST define failure behavior:

- all-or-nothing transaction,
- per-record transaction,
- staging table,
- idempotency key,
- error report with line/offset/record number,
- retry/resume semantics.

Never partially import regulatory data without an audit trail.

---

## 8. Output and marshalling rules

### 8.1 Outbound XML MUST be generated from DTOs

The LLM MUST generate outbound XML using dedicated output structs or controlled streaming encoder.

Forbidden:

```go
fmt.Fprintf(w, "<Name>%s</Name>", name)
```

Required:

```go
enc := xml.NewEncoder(w)
if err := enc.Encode(resp); err != nil {
	return err
}
if err := enc.Flush(); err != nil {
	return err
}
```

Manual string concatenation is allowed only for static templates with properly escaped dynamic values and explicit review.

---

### 8.2 XML headers and content type MUST be explicit

For HTTP XML responses:

```go
w.Header().Set("Content-Type", "application/xml; charset=utf-8")
w.WriteHeader(http.StatusOK)
```

If XML declaration is required:

```go
w.Write([]byte(xml.Header))
```

---

### 8.3 Stable ordering MUST be tested when required

XML consumers may depend on element order. The LLM MUST implement order exactly as specified.

Rules:

- Struct field order controls marshal order.
- Maps MUST NOT be used where output order matters.
- Repeated elements MUST preserve contract order.
- Golden tests MUST cover required ordering.

---

### 8.4 XML escaping MUST be automatic or explicit

The LLM MUST rely on `encoding/xml` escaping for text/attributes when possible.

Forbidden:

```go
out := "<Name>" + userInput + "</Name>"
```

Allowed:

```go
xml.EscapeText(w, []byte(userInput))
```

Raw XML injection with `,innerxml` MUST be rejected unless content is trusted and reviewed.

---

## 9. SOAP rules

SOAP handling MUST separate:

- envelope,
- header,
- body,
- operation payload,
- fault payload,
- transport status.

The LLM MUST NOT decode SOAP body directly into business payload without validating envelope and body element.

Required shape:

```go
type SOAPEnvelope struct {
	XMLName xml.Name `xml:"http://schemas.xmlsoap.org/soap/envelope/ Envelope"`
	Header  *SOAPHeader `xml:"Header"`
	Body    SOAPBody    `xml:"Body"`
}
```

SOAP fault mapping MUST produce typed application/integration errors.

---

## 10. Validation and mapping rules

### 10.1 XML parse success is not validation success

After XML decode, the LLM MUST perform:

- required field validation,
- enum validation,
- numeric range validation,
- date/time validation,
- namespace validation,
- cross-field validation,
- domain invariant validation,
- authorization validation if command-bearing.

---

### 10.2 Mapper MUST convert XML DTO into domain command/value object

Required:

```go
func (x CaseSubmissionXML) ToCommand() (CreateCaseCommand, error) {
	caseID, err := ParseCaseID(x.CaseID)
	if err != nil {
		return CreateCaseCommand{}, err
	}
	return CreateCaseCommand{CaseID: caseID}, nil
}
```

The mapper MUST be explicit about:

- trimming policy,
- Unicode normalization policy,
- timezone/date policy,
- empty vs missing behavior,
- default values,
- external code mapping.

---

## 11. Schema and versioning rules

### 11.1 Schema version MUST be explicit for long-lived XML

For archival, event-like, regulatory, or partner XML, include or validate schema version.

Example:

```go
type SubmissionXML struct {
	XMLName       xml.Name `xml:"Submission"`
	SchemaVersion string   `xml:"schemaVersion,attr"`
}
```

Rules:

- Old versions MUST decode via version-specific DTOs or migration code.
- Do not make one “mega struct” with optional fields for all historical versions.
- Version migration MUST be tested with real fixtures.

---

### 11.2 Schema validation is outside `encoding/xml`

If the contract requires XSD validation, the LLM MUST not pretend `encoding/xml` provides it.

The LLM MUST either:

- call an approved schema validation library/tool,
- validate the required subset manually,
- or document that schema validation is performed upstream/downstream.

---

## 12. Logging and telemetry rules

XML processing logs MUST include:

- operation name,
- source system,
- schema version,
- document size bucket,
- record count if known,
- validation result,
- request/correlation id,
- duration,
- failure category.

Logs MUST NOT include full raw XML by default.

Metrics SHOULD include:

- decode duration,
- document size,
- record count,
- validation failures by category,
- partner/system label with low cardinality,
- retry/fault count.

---

## 13. Testing requirements

XML code MUST have tests for:

- valid minimal XML,
- valid full XML,
- malformed XML,
- unexpected root element,
- namespace mismatch,
- missing required element,
- missing required attribute,
- unknown element/attribute according to policy,
- empty element,
- whitespace-only value,
- repeated elements,
- element ordering if meaningful,
- special characters escaping,
- unsupported charset,
- oversized document,
- deeply nested document,
- mixed content if supported,
- `xsi:nil` if supported,
- SOAP fault if applicable,
- version migration if applicable.

Golden tests MUST be used for outbound regulatory/partner XML.

---

## 14. Fuzzing requirements

The LLM SHOULD fuzz:

- custom token parsers,
- custom XML value unmarshalers,
- namespace validators,
- date/number parsers,
- extension-field handlers,
- sanitizer/redactor functions.

Fuzz invariants:

- no panic,
- bounded depth/memory,
- invalid data rejected,
- no raw secret leak in errors/logs,
- well-formed output remains well-formed.

---

## 15. Anti-patterns

The LLM MUST NOT introduce these patterns:

- unbounded XML decoding,
- decoding XML directly into domain entities,
- ignoring namespaces accidentally,
- assuming prefixes are stable semantic identifiers,
- accepting unknown elements without policy,
- using `,innerxml` on untrusted input,
- string-concatenating XML with user data,
- logging full raw XML payloads by default,
- pretending `encoding/xml` performs XSD validation,
- using maps when XML output ordering matters,
- resolving external entities from untrusted XML,
- silently accepting unsupported character encodings,
- treating XML parse success as business validation success.

---

## 16. LLM implementation checklist

Before submitting XML-related code, the LLM MUST verify:

- [ ] XML boundary is classified: inbound, outbound, SOAP, config, archive, partner, regulatory.
- [ ] Input size is bounded.
- [ ] DTO is separate from domain model.
- [ ] Root element and namespace are validated.
- [ ] Unknown element/attribute policy is explicit.
- [ ] Character set policy is explicit.
- [ ] Entity handling does not introduce external file/network resolution.
- [ ] Large documents use streaming.
- [ ] Optional/empty/missing/nil semantics are tested.
- [ ] XML output uses encoder or safe escaping.
- [ ] Output ordering is tested when required.
- [ ] Schema/version strategy is documented.
- [ ] Error mapping is caller-safe.
- [ ] Logs are redacted and bounded.
- [ ] Golden tests exist for external/regulatory XML.
- [ ] Fuzz tests exist for custom parsers where appropriate.
