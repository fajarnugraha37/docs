# learn-java-json-xml-soap-connectors-enterprise-integration — Part 22
# SOAP Mental Model: Envelope, Header, Body, Fault, SOAP 1.1 vs 1.2, Document-Literal, RPC Legacy, and Why SOAP Survived

> Seri: Java JSON, XML, SOAP Legacy, dan Jakarta Connectors untuk Java 8–25  
> Bagian: 22 dari 34  
> Status seri: belum selesai  
> Fokus: membangun mental model SOAP sebagai message protocol dan enterprise contract, bukan sekadar XML yang dikirim lewat HTTP.

---

## 0. Tujuan Part Ini

Setelah JSON-P/JSON-B dan JAXB, kita masuk ke wilayah yang sering dianggap “legacy”, yaitu SOAP. Banyak engineer modern hanya melihat SOAP sebagai:

> XML besar, lambat, ribet, dan tua.

Pandangan itu tidak sepenuhnya salah dari sisi ergonomi, tetapi terlalu dangkal. Di enterprise, banking, government, telco, insurance, healthcare, dan sistem regulator, SOAP bertahan bukan karena lebih indah dari REST, melainkan karena ia membawa model kontrak yang berbeda:

1. **message envelope yang standar**;
2. **header extensibility** untuk security, routing, transaction, addressing, policy, dan metadata;
3. **body payload contract** yang biasanya dikunci oleh WSDL + XSD;
4. **fault model** untuk error formal;
5. **tooling code generation** untuk sistem yang ingin strong contract;
6. **interop story** dengan stack enterprise lama seperti .NET WCF, IBM, Oracle, SAP, mainframe gateway, dan application server;
7. **WS-* ecosystem** untuk fitur yang tidak mudah direpresentasikan hanya dengan HTTP resource style.

Part ini tidak akan langsung membahas implementasi JAX-WS server/client secara detail. Itu masuk Part 24 dan Part 25. Bagian ini adalah fondasi mental model agar ketika nanti melihat `@WebService`, WSDL, `BindingProvider`, SOAP handler, MTOM, atau WS-Security, kita tidak hanya menghafal API, tetapi memahami struktur yang sedang berjalan.

Referensi resmi utama:

- W3C SOAP 1.1 Note: <https://www.w3.org/TR/2000/NOTE-SOAP-20000508/>
- W3C SOAP 1.2 Part 1 Messaging Framework: <https://www.w3.org/TR/soap12-part1/>
- W3C SOAP 1.2 Part 2 Adjuncts: <https://www.w3.org/TR/soap12-part2/>
- Jakarta XML Web Services 4.0: <https://jakarta.ee/specifications/xml-web-services/4.0/>
- Jakarta SOAP with Attachments 3.0: <https://jakarta.ee/specifications/soap-attachments/3.0/>
- Jakarta EE Tutorial — XML Web Services: <https://jakarta.ee/learn/docs/jakartaee-tutorial/9.1/websvcs/jaxws/jaxws.html>

---

## 1. SOAP dalam Satu Kalimat yang Benar

SOAP adalah **XML-based messaging framework** untuk pertukaran informasi terstruktur dalam lingkungan terdistribusi, dengan envelope standar, mekanisme extensibility lewat header, body untuk payload aplikasi, fault untuk error formal, dan binding ke transport seperti HTTP.

Yang penting: SOAP bukan hanya “protocol remote method call”. SOAP bisa dipakai sebagai RPC, tetapi desain dasarnya lebih umum: **message exchange framework**.

Mental model yang lebih tepat:

```text
SOAP Message
└── Envelope
    ├── Header?  -> metadata, extension, security, routing, addressing, policy
    └── Body     -> business payload atau Fault
```

SOAP bukan menggantikan HTTP sepenuhnya. SOAP biasanya **menumpang** di HTTP, JMS, atau transport lain. HTTP hanya carrier. SOAP message tetap punya struktur dan aturan sendiri.

---

## 2. Kenapa SOAP Masih Penting untuk Top-Level Java Engineer

Seorang engineer yang hanya bekerja di greenfield REST/JSON mungkin jarang menyentuh SOAP. Tetapi engineer senior/top-tier sering harus menghadapi realitas berikut:

1. **Sistem lama tidak otomatis hilang**  
   Core banking, payment gateway, licensing, customs, tax, insurance claim, identity provider lama, SAP, mainframe adapter, dan government-to-government integration sering masih expose SOAP.

2. **Contract-first integration masih bernilai**  
   WSDL + XSD memberi kontrak formal yang bisa divalidasi, digenerate, dites, dan diaudit.

3. **SOAP punya message-level extensibility**  
   Security, timestamp, signature, routing, addressing, dan correlation dapat hidup di SOAP Header tanpa mengubah body bisnis.

4. **Interop enterprise historically kuat**  
   Java, .NET, IBM, Oracle, SAP, dan application server lama punya tooling SOAP yang matang.

5. **Regulated integration sering butuh jejak kontrak eksplisit**  
   Dalam sistem yang harus defensible, kontrak XSD/WSDL dan SOAP Fault sering lebih mudah dijelaskan daripada endpoint JSON yang longgar.

6. **Migrasi legacy butuh pemahaman source system**  
   Untuk membangun facade REST di depan SOAP legacy, engineer harus mengerti semantics SOAP-nya agar tidak merusak idempotency, fault mapping, dan security.

Top 1% engineer tidak harus menyukai SOAP. Tetapi ia harus bisa membedakan:

```text
SOAP as historical accident
vs
SOAP as formal enterprise message contract
```

Yang pertama mudah diejek. Yang kedua harus dipahami.

---

## 3. SOAP Bukan REST, Bukan JSON-RPC, dan Bukan Sekadar XML over HTTP

### 3.1 REST/resource-oriented view

REST biasanya berpikir:

```text
Resource + HTTP method + representation + status code

GET    /cases/123
PATCH  /cases/123
POST   /applications
DELETE /drafts/456
```

Kontrak utama ada pada:

- URI;
- HTTP method;
- request/response representation;
- HTTP status;
- headers;
- semantic constraint seperti cacheability, idempotency, content negotiation.

### 3.2 SOAP/message-oriented view

SOAP biasanya berpikir:

```text
Operation or message exchange + envelope + headers + body + fault

POST /CaseService
SOAPAction: "createCase"

<Envelope>
  <Header>...</Header>
  <Body>
    <CreateCaseRequest>...</CreateCaseRequest>
  </Body>
</Envelope>
```

Kontrak utama ada pada:

- WSDL operation;
- XML Schema type;
- SOAP binding;
- envelope version;
- header blocks;
- fault contract;
- policy/security metadata.

### 3.3 JSON-RPC style

JSON-RPC biasanya berpikir:

```json
{
  "jsonrpc": "2.0",
  "method": "createCase",
  "params": { ... },
  "id": "123"
}
```

SOAP bisa menyerupai RPC, tetapi SOAP punya envelope/header/fault formal dan historical WS-* ecosystem.

### 3.4 Kenapa “XML over HTTP” tidak cukup menggambarkan SOAP

Kalau hanya XML over HTTP, maka semua semantics harus dibuat sendiri:

```xml
<request>
  <auth>...</auth>
  <payload>...</payload>
</request>
```

SOAP memberikan struktur standar:

```xml
<soap:Envelope>
  <soap:Header>
    <!-- extension metadata -->
  </soap:Header>
  <soap:Body>
    <!-- application message or fault -->
  </soap:Body>
</soap:Envelope>
```

Perbedaannya bukan pada XML-nya, tetapi pada **processing model**.

---

## 4. SOAP Message Anatomy

SOAP message terdiri dari satu `Envelope` sebagai root element. Di dalamnya ada optional `Header` dan mandatory `Body`.

Contoh SOAP 1.1 sederhana:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:case="urn:example:case:v1">

  <soapenv:Header>
    <case:CorrelationId>REQ-2026-00001</case:CorrelationId>
  </soapenv:Header>

  <soapenv:Body>
    <case:CreateCaseRequest>
      <case:applicantId>A123</case:applicantId>
      <case:caseType>ENFORCEMENT</case:caseType>
    </case:CreateCaseRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

Contoh SOAP 1.2 sederhana:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope
    xmlns:env="http://www.w3.org/2003/05/soap-envelope"
    xmlns:case="urn:example:case:v1">

  <env:Header>
    <case:CorrelationId>REQ-2026-00001</case:CorrelationId>
  </env:Header>

  <env:Body>
    <case:CreateCaseRequest>
      <case:applicantId>A123</case:applicantId>
      <case:caseType>ENFORCEMENT</case:caseType>
    </case:CreateCaseRequest>
  </env:Body>
</env:Envelope>
```

Perhatikan namespace envelope berbeda:

| SOAP Version | Envelope Namespace |
|---|---|
| SOAP 1.1 | `http://schemas.xmlsoap.org/soap/envelope/` |
| SOAP 1.2 | `http://www.w3.org/2003/05/soap-envelope` |

Ini bukan detail kosmetik. Kalau client mengirim SOAP 1.2 envelope ke service yang hanya menerima SOAP 1.1, service bisa menolak message.

---

## 5. Envelope: Boundary Terluar Pesan

`Envelope` adalah root XML element yang menyatakan:

> Dokumen XML ini adalah SOAP message.

Ia menentukan:

1. SOAP version melalui namespace;
2. batas antara metadata protocol-level dan payload aplikasi;
3. grammar dasar message;
4. aturan processing untuk header/body/fault.

Contoh:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  ...
</soap:Envelope>
```

Dalam mental model enterprise, envelope adalah **integration boundary**. Ia membungkus message sehingga intermediary, gateway, security component, handler, atau endpoint bisa memproses metadata tanpa harus memahami business payload sepenuhnya.

```text
Client
  -> SOAP message
      -> gateway reads Header
          -> security handler validates signature
              -> service reads Body
```

Ini berbeda dari JSON API biasa yang sering mencampur metadata dan data bisnis dalam satu payload arbitrer.

---

## 6. Header: Extensibility Layer

SOAP Header adalah tempat untuk informasi tambahan yang tidak termasuk business payload utama.

Contoh:

```xml
<soap:Header>
  <auth:SecurityToken xmlns:auth="urn:example:auth:v1">
    abc123
  </auth:SecurityToken>

  <obs:CorrelationId xmlns:obs="urn:example:observability:v1">
    REQ-2026-00001
  </obs:CorrelationId>
</soap:Header>
```

Header biasanya dipakai untuk:

- authentication/security token;
- WS-Security signature/timestamp;
- correlation ID;
- routing;
- addressing;
- transaction context;
- tenant context;
- locale;
- client application identity;
- policy metadata;
- audit metadata.

### 6.1 Kenapa header penting?

Header memungkinkan kita menambahkan cross-cutting concern tanpa mengubah body bisnis.

```text
Body = apa yang ingin dilakukan secara bisnis
Header = bagaimana pesan harus diproses
```

Contoh body:

```xml
<case:CreateCaseRequest>
  <case:applicantId>A123</case:applicantId>
</case:CreateCaseRequest>
```

Contoh header:

```xml
<wsse:Security>...</wsse:Security>
<wsa:Action>urn:createCase</wsa:Action>
<obs:CorrelationId>REQ-1</obs:CorrelationId>
```

Body tetap stabil, sementara security/addressing/observability bisa berkembang.

### 6.2 Header block

Dalam SOAP, tiap child element di dalam `Header` sering disebut header block.

```xml
<soap:Header>
  <m:HeaderBlockA xmlns:m="urn:a">...</m:HeaderBlockA>
  <n:HeaderBlockB xmlns:n="urn:b">...</n:HeaderBlockB>
</soap:Header>
```

Setiap header block dapat punya target/role dan mandatory processing rule.

---

## 7. mustUnderstand: Jangan Diam-Diam Abaikan Metadata Penting

Salah satu fitur penting SOAP adalah `mustUnderstand`.

Pada SOAP 1.1:

```xml
<soapenv:Header>
  <sec:Security
      xmlns:sec="urn:example:security:v1"
      soapenv:mustUnderstand="1">
    ...
  </sec:Security>
</soapenv:Header>
```

Pada SOAP 1.2:

```xml
<env:Header>
  <sec:Security
      xmlns:sec="urn:example:security:v1"
      env:mustUnderstand="true">
    ...
  </sec:Security>
</env:Header>
```

Maknanya:

> Node yang menjadi target header ini harus memahami dan memproses header tersebut. Jika tidak, message harus gagal.

Ini sangat penting untuk security dan correctness.

Tanpa `mustUnderstand`, sebuah service/gateway mungkin mengabaikan header penting:

```text
Client thinks: request must be signed
Gateway thinks: I do not know this header, skip
Service processes body anyway
```

Dengan `mustUnderstand`, pesan gagal jika header mandatory tidak dipahami.

### 7.1 Mental model

`mustUnderstand` adalah semacam **semantic circuit breaker**.

Ia mencegah silent downgrade.

```text
Unknown optional header     -> boleh diabaikan
Unknown mandatory header    -> harus fault
```

### 7.2 Failure yang sering terjadi

1. Client menambahkan security header dengan `mustUnderstand=1`.
2. Server belum punya handler WS-Security.
3. Server mengembalikan fault `MustUnderstand`.
4. Tim aplikasi mengira payload salah, padahal masalahnya handler/policy mismatch.

Top-tier debugging SOAP selalu mengecek:

- SOAP version;
- namespace header;
- `mustUnderstand`;
- actor/role;
- handler chain;
- security policy;
- WSDL binding.

---

## 8. actor / role: Siapa yang Harus Memproses Header?

SOAP message bisa melewati beberapa node:

```text
Initial Sender -> Gateway -> Security Intermediary -> Business Service -> Final Receiver
```

Tidak semua header harus diproses oleh final receiver. Beberapa header ditujukan ke intermediary.

SOAP 1.1 memakai attribute `actor`:

```xml
<soapenv:Header>
  <gw:Routing
      xmlns:gw="urn:example:gateway:v1"
      soapenv:actor="http://schemas.xmlsoap.org/soap/actor/next"
      soapenv:mustUnderstand="1">
    ...
  </gw:Routing>
</soapenv:Header>
```

SOAP 1.2 memakai attribute `role`:

```xml
<env:Header>
  <gw:Routing
      xmlns:gw="urn:example:gateway:v1"
      env:role="http://www.w3.org/2003/05/soap-envelope/role/next"
      env:mustUnderstand="true">
    ...
  </gw:Routing>
</env:Header>
```

Mental model:

```text
Header block = instruction
actor/role   = recipient of instruction
mustUnderstand = whether recipient may ignore it
```

Dalam sistem sederhana point-to-point, actor/role jarang terlihat. Dalam enterprise bus/gateway, ia menjadi penting.

---

## 9. Body: Business Payload atau Fault

SOAP Body adalah tempat payload utama.

```xml
<soap:Body>
  <case:CreateCaseRequest xmlns:case="urn:example:case:v1">
    <case:applicantId>A123</case:applicantId>
  </case:CreateCaseRequest>
</soap:Body>
```

Dalam request normal, Body berisi operation input. Dalam response normal, Body berisi operation output.

Request:

```xml
<soap:Body>
  <case:GetCaseRequest>
    <case:caseId>C-001</case:caseId>
  </case:GetCaseRequest>
</soap:Body>
```

Response:

```xml
<soap:Body>
  <case:GetCaseResponse>
    <case:caseId>C-001</case:caseId>
    <case:status>OPEN</case:status>
  </case:GetCaseResponse>
</soap:Body>
```

Fault:

```xml
<soap:Body>
  <soap:Fault>...</soap:Fault>
</soap:Body>
```

### 9.1 Body bukan tempat semua metadata

Kesalahan desain yang sering terjadi:

```xml
<CreateCaseRequest>
  <username>...</username>
  <password>...</password>
  <correlationId>...</correlationId>
  <businessData>...</businessData>
</CreateCaseRequest>
```

Lebih rapi jika cross-cutting metadata masuk Header:

```xml
<soap:Header>
  <sec:Security>...</sec:Security>
  <obs:CorrelationId>...</obs:CorrelationId>
</soap:Header>
<soap:Body>
  <case:CreateCaseRequest>...</case:CreateCaseRequest>
</soap:Body>
```

Tetapi dalam real legacy system, metadata sering berada di body karena desain awal tidak memakai SOAP extension dengan benar. Sebagai engineer, kita harus bisa membaca legacy tanpa langsung memaksakan idealisme.

---

## 10. Fault: Error Sebagai Message Contract

SOAP Fault adalah mekanisme standar untuk melaporkan error.

Pada SOAP 1.1, fault bentuknya kira-kira:

```xml
<soapenv:Fault>
  <faultcode>soapenv:Client</faultcode>
  <faultstring>Invalid request</faultstring>
  <faultactor>urn:case-service</faultactor>
  <detail>
    <case:ValidationFault xmlns:case="urn:example:case:v1">
      <case:field>applicantId</case:field>
      <case:message>Applicant ID is required</case:message>
    </case:ValidationFault>
  </detail>
</soapenv:Fault>
```

Pada SOAP 1.2, fault bentuknya berbeda:

```xml
<env:Fault>
  <env:Code>
    <env:Value>env:Sender</env:Value>
  </env:Code>
  <env:Reason>
    <env:Text xml:lang="en">Invalid request</env:Text>
  </env:Reason>
  <env:Detail>
    <case:ValidationFault xmlns:case="urn:example:case:v1">
      <case:field>applicantId</case:field>
      <case:message>Applicant ID is required</case:message>
    </case:ValidationFault>
  </env:Detail>
</env:Fault>
```

### 10.1 SOAP 1.1 fault fields

| Field | Makna |
|---|---|
| `faultcode` | Kategori error formal |
| `faultstring` | Penjelasan human-readable |
| `faultactor` | Node yang menyebabkan fault, optional |
| `detail` | Detail aplikasi, biasanya typed XML |

Common SOAP 1.1 fault codes:

| Fault Code | Makna Umum |
|---|---|
| `VersionMismatch` | Envelope namespace/version tidak sesuai |
| `MustUnderstand` | Header mandatory tidak dipahami |
| `Client` | Request dari client salah |
| `Server` | Server gagal memproses request valid |

### 10.2 SOAP 1.2 fault fields

| Field | Makna |
|---|---|
| `Code` | Kategori error formal |
| `Subcode` | Kategori tambahan, optional |
| `Reason` | Human-readable text, dapat multilingual |
| `Node` | SOAP node yang menghasilkan fault |
| `Role` | Role saat fault terjadi |
| `Detail` | Detail aplikasi |

Common SOAP 1.2 fault codes:

| Fault Code | Makna Umum |
|---|---|
| `VersionMismatch` | SOAP version tidak cocok |
| `MustUnderstand` | Header mandatory tidak diproses |
| `Sender` | Masalah dari sender/client |
| `Receiver` | Masalah dari receiver/server |
| `DataEncodingUnknown` | Encoding tidak didukung |

### 10.3 Fault bukan sekadar exception stack trace

SOAP Fault yang baik adalah bagian dari kontrak.

Buruk:

```xml
<faultstring>java.lang.NullPointerException</faultstring>
```

Lebih baik:

```xml
<faultstring>Validation failed</faultstring>
<detail>
  <case:ValidationFault>
    <case:errorCode>CASE-VAL-001</case:errorCode>
    <case:field>applicantId</case:field>
    <case:message>Applicant ID is required</case:message>
  </case:ValidationFault>
</detail>
```

Dalam JAX-WS, ini nanti terkait dengan **modeled fault** vs **unmodeled fault**.

---

## 11. SOAP 1.1 vs SOAP 1.2

SOAP 1.1 dan 1.2 mirip secara konsep, tetapi tidak identik.

| Aspek | SOAP 1.1 | SOAP 1.2 |
|---|---|---|
| Status | W3C Note | W3C Recommendation |
| Envelope namespace | `http://schemas.xmlsoap.org/soap/envelope/` | `http://www.w3.org/2003/05/soap-envelope` |
| HTTP media type | sering `text/xml` | `application/soap+xml` |
| Action | sering lewat HTTP `SOAPAction` header | action dapat menjadi parameter media type/binding |
| Header target | `actor` | `role` |
| Mandatory processing | `mustUnderstand="1"` | `mustUnderstand="true"` atau `1` |
| Client/server fault | `Client` / `Server` | `Sender` / `Receiver` |
| Fault structure | `faultcode`, `faultstring`, `detail` | `Code`, `Reason`, `Detail`, dll |
| Data encoding | SOAP encoding historically common | lebih ketat dan diperjelas |

### 11.1 Compatibility consequence

SOAP version mismatch adalah real production issue.

Contoh mismatch:

```text
Client sends:
Content-Type: application/soap+xml
Envelope namespace: http://www.w3.org/2003/05/soap-envelope

Server expects:
Content-Type: text/xml
Envelope namespace: http://schemas.xmlsoap.org/soap/envelope/
```

Gejala:

- HTTP 415 Unsupported Media Type;
- SOAP Fault `VersionMismatch`;
- server returns HTML error page;
- proxy/gateway rejects before app sees request;
- generated client error yang membingungkan.

Debug checklist:

```text
[ ] SOAP 1.1 atau SOAP 1.2?
[ ] Envelope namespace benar?
[ ] Content-Type benar?
[ ] SOAPAction diperlukan?
[ ] WSDL binding menunjukkan soap:binding atau soap12:binding?
[ ] Client generated dari WSDL versi yang benar?
```

---

## 12. SOAP Binding ke HTTP

SOAP sering dikirim lewat HTTP POST.

Contoh SOAP 1.1 HTTP request:

```http
POST /CaseService HTTP/1.1
Host: example.internal
Content-Type: text/xml; charset=utf-8
SOAPAction: "urn:createCase"

<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <case:CreateCaseRequest xmlns:case="urn:example:case:v1">
      <case:applicantId>A123</case:applicantId>
    </case:CreateCaseRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

Contoh SOAP 1.2 HTTP request:

```http
POST /CaseService HTTP/1.1
Host: example.internal
Content-Type: application/soap+xml; charset=utf-8; action="urn:createCase"

<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Body>
    <case:CreateCaseRequest xmlns:case="urn:example:case:v1">
      <case:applicantId>A123</case:applicantId>
    </case:CreateCaseRequest>
  </env:Body>
</env:Envelope>
```

### 12.1 HTTP status vs SOAP Fault

SOAP-over-HTTP membuat dua layer status:

```text
HTTP layer status
SOAP message/fault layer status
```

Contoh:

| Scenario | HTTP Status | SOAP Body |
|---|---:|---|
| Success | 200 | normal response |
| Business validation fault | 200 atau 500, tergantung stack/policy | SOAP Fault detail |
| Server processing fault | 500 | SOAP Fault |
| Bad content type | 415 | bisa non-SOAP response |
| Auth failure at gateway | 401/403 | bisa non-SOAP response |
| Proxy timeout | 504 | no SOAP body |

Dalam integration robust, jangan menganggap semua error SOAP akan punya SOAP Fault. Kadang error muncul sebelum SOAP runtime memproses message.

### 12.2 Common failure: SOAP service returns HTML

Banyak client JAX-WS gagal dengan error seperti:

```text
Unexpected EOF
Content is not allowed in prolog
Invalid XML
Premature end of file
```

Root cause sering bukan XML payload, tetapi server/gateway mengembalikan HTML:

```html
<html><body>502 Bad Gateway</body></html>
```

Top-tier approach:

1. Capture raw HTTP request/response.
2. Validate status code.
3. Validate content type.
4. Validate body is SOAP envelope.
5. Baru lihat JAXB/JAX-WS binding error.

---

## 13. SOAP Operation Styles: RPC vs Document

SOAP historically mendukung beberapa style. Yang paling sering muncul:

1. RPC style;
2. Document style;
3. encoded use;
4. literal use.

Kombinasi umum:

```text
rpc/encoded       -> legacy, problematic interoperability
rpc/literal       -> less common
 document/encoded -> rare/problematic
 document/literal -> preferred modern interoperable style
```

### 13.1 RPC style

RPC style memodelkan message seperti method call.

```text
method: createCase(applicantId, caseType)
```

SOAP body kira-kira:

```xml
<soap:Body>
  <createCase xmlns="urn:example:case:v1">
    <applicantId>A123</applicantId>
    <caseType>ENFORCEMENT</caseType>
  </createCase>
</soap:Body>
```

Kelebihan:

- familiar untuk developer;
- maps easily to method call;
- cocok untuk tooling lama.

Kekurangan:

- terlalu coupling ke operation/method;
- interoperability lebih sulit jika memakai encoded;
- contract evolution cenderung brittle;
- tidak sebersih document-style untuk schema validation.

### 13.2 Document style

Document style memodelkan body sebagai XML document.

```xml
<soap:Body>
  <case:CreateCaseRequest xmlns:case="urn:example:case:v1">
    <case:applicantId>A123</case:applicantId>
    <case:caseType>ENFORCEMENT</case:caseType>
  </case:CreateCaseRequest>
</soap:Body>
```

Kelebihan:

- payload berorientasi dokumen/kontrak;
- lebih natural untuk XSD;
- lebih mudah evolusi bila didesain baik;
- interoperable dengan WS-I Basic Profile style.

Kekurangan:

- terasa lebih verbose;
- operation mapping kadang tidak obvious tanpa WSDL;
- wrapper convention harus dipahami.

---

## 14. encoded vs literal

### 14.1 encoded

`encoded` berarti serialization mengikuti SOAP encoding rules.

Historically:

```xml
<soap:Body>
  <m:createCase soapenc:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    ...
  </m:createCase>
</soap:Body>
```

Masalah:

- interoperability buruk;
- tidak selalu valid terhadap XSD literal contract;
- multi-reference/object graph style sulit dipahami lintas platform;
- modern enterprise profile biasanya menghindarinya.

### 14.2 literal

`literal` berarti XML body mengikuti schema secara literal.

```xml
<case:CreateCaseRequest xmlns:case="urn:example:case:v1">
  ...
</case:CreateCaseRequest>
```

Keuntungan:

- schema validation lebih jelas;
- contract-first lebih kuat;
- tooling modern lebih predictable;
- better interoperability.

Rule of thumb:

```text
Prefer document/literal.
Avoid rpc/encoded unless forced by legacy system.
```

---

## 15. Document-Literal Wrapped

Document-literal wrapped adalah convention yang sangat umum dalam JAX-WS/WSDL interoperable services.

Strukturnya:

```xml
<soap:Body>
  <ns:operationName>
    <ns:param1>...</ns:param1>
    <ns:param2>...</ns:param2>
  </ns:operationName>
</soap:Body>
```

Contoh:

```xml
<soap:Body>
  <case:createCase xmlns:case="urn:example:case:v1">
    <case:applicantId>A123</case:applicantId>
    <case:caseType>ENFORCEMENT</case:caseType>
  </case:createCase>
</soap:Body>
```

Response:

```xml
<soap:Body>
  <case:createCaseResponse xmlns:case="urn:example:case:v1">
    <case:caseId>C-001</case:caseId>
  </case:createCaseResponse>
</soap:Body>
```

### 15.1 Kenapa disebut wrapped?

Karena parameter method dibungkus oleh wrapper element.

Java method:

```java
String createCase(String applicantId, String caseType);
```

SOAP body:

```xml
<createCase>
  <applicantId>A123</applicantId>
  <caseType>ENFORCEMENT</caseType>
</createCase>
```

Wrapper element biasanya sama dengan operation name.

### 15.2 Wrapped vs bare

Document-literal bare:

```xml
<soap:Body>
  <case:CreateCaseRequest>
    ...
  </case:CreateCaseRequest>
</soap:Body>
```

Document-literal wrapped:

```xml
<soap:Body>
  <case:createCase>
    <case:request>...</case:request>
  </case:createCase>
</soap:Body>
```

Bare lebih document-pure. Wrapped lebih method-friendly dan umum di JAX-WS tooling.

### 15.3 Design consequence

Wrapped bisa terlihat nyaman, tetapi hati-hati:

```java
void updateCase(String caseId, String status, String reason, String updatedBy, String comment)
```

Akan menjadi contract yang mirip parameter list. Untuk operasi enterprise, sering lebih baik memakai request object eksplisit:

```java
UpdateCaseResponse updateCase(UpdateCaseRequest request)
```

Payload:

```xml
<UpdateCaseRequest>
  <caseId>C-001</caseId>
  <status>CLOSED</status>
  <reason>...</reason>
  <updatedBy>...</updatedBy>
  <comment>...</comment>
</UpdateCaseRequest>
```

Ini lebih stabil untuk evolution.

---

## 16. WSDL dalam Mental Model SOAP

WSDL akan dibahas dalam Part 23, tetapi di Part 22 kita perlu memahami posisinya.

SOAP message adalah instance runtime. WSDL adalah kontrak yang mendeskripsikan:

```text
What operations exist?
What messages are exchanged?
What XML types are used?
What SOAP binding style/use is used?
Where is the endpoint?
```

Simplified WSDL mental map:

```text
WSDL
├── types       -> XSD schemas
├── message     -> abstract input/output/fault messages
├── portType    -> abstract operations
├── binding     -> SOAP style/use/transport binding
└── service     -> concrete endpoint address
```

WSDL menentukan apakah service memakai SOAP 1.1 atau 1.2, operation style, endpoint URL, fault, dan XML schema.

Saat debugging SOAP, jangan hanya lihat Java code. Lihat WSDL.

---

## 17. SOAPAction: Small Header, Big Debugging Pain

Pada SOAP 1.1 over HTTP, `SOAPAction` adalah HTTP header yang sering dipakai untuk mengindikasikan intent operation.

```http
SOAPAction: "urn:createCase"
```

Banyak stack legacy/gateway memakai `SOAPAction` untuk routing.

Masalah umum:

| Problem | Gejala |
|---|---|
| SOAPAction kosong padahal server expect value | operation not found |
| SOAPAction salah quote | 500/404/routing failure |
| SOAPAction berbeda dari WSDL | gateway reject |
| SOAP 1.2 client tidak kirim SOAPAction header | legacy SOAP 1.1 server reject |

Rule:

```text
For SOAP 1.1 legacy: always inspect SOAPAction.
For SOAP 1.2: inspect Content-Type action parameter and binding behavior.
```

---

## 18. Namespace adalah Identitas Kontrak

SOAP integration sering gagal karena namespace mismatch, bukan karena element name salah secara visual.

Berbeda:

```xml
<CreateCaseRequest xmlns="urn:example:case:v1">
```

vs

```xml
<CreateCaseRequest xmlns="urn:example:case:v2">
```

Secara teks mirip, secara QName berbeda.

QName = namespace URI + local name.

```text
{urn:example:case:v1}CreateCaseRequest
!=
{urn:example:case:v2}CreateCaseRequest
```

Dalam SOAP/JAXB/WSDL, QName adalah kunci utama.

### 18.1 Common namespace mistakes

1. Default namespace hilang.
2. Prefix berubah lalu dianggap masalah, padahal namespace URI sama.
3. Namespace URI berubah walau prefix sama.
4. JAXB generated class memakai namespace yang berbeda dari WSDL runtime.
5. Request wrapper namespace salah.
6. Fault detail namespace salah.

Yang penting bukan prefix, tetapi namespace URI.

```xml
<a:CreateCaseRequest xmlns:a="urn:case:v1"/>
<b:CreateCaseRequest xmlns:b="urn:case:v1"/>
```

Dua element di atas QName-nya sama.

```xml
<case:CreateCaseRequest xmlns:case="urn:case:v1"/>
<case:CreateCaseRequest xmlns:case="urn:case:v2"/>
```

Dua element di atas QName-nya berbeda.

---

## 19. SOAP Node, Intermediary, dan Processing Path

SOAP tidak selalu point-to-point secara konseptual. Ada node yang memproses message sepanjang path.

```text
Initial Sender
  -> SOAP Gateway
  -> Security Intermediary
  -> Routing Intermediary
  -> Ultimate Receiver
```

Setiap node bisa:

- memproses header yang ditargetkan kepadanya;
- meneruskan message;
- menghapus atau menambah header tertentu;
- menghasilkan fault;
- menjadi ultimate receiver.

Mental model ini menjelaskan kenapa Header punya `actor`/`role` dan `mustUnderstand`.

Di sistem modern, intermediary bisa berupa:

- API gateway;
- ESB;
- service mesh adapter;
- security appliance;
- SOAP gateway;
- reverse proxy;
- integration broker;
- middleware vendor.

Saat debugging, jangan hanya tanya “server aplikasinya menerima apa?”. Tanya:

```text
Message berubah di node mana?
Header mana yang diproses gateway?
Apakah signature masih valid setelah intermediary memodifikasi XML?
Apakah proxy mengubah Content-Type/SOAPAction?
Apakah gateway melakukan schema validation?
```

---

## 20. SOAP Security: Transport vs Message-Level Preview

SOAP security detail akan dibahas Part 29. Di sini kita hanya butuh mental model.

### 20.1 TLS / transport security

TLS melindungi channel:

```text
Client <====== encrypted transport ======> Server/Gateway
```

Kelebihan:

- simpler;
- widely supported;
- protects in transit between two TLS endpoints.

Keterbatasan:

- protection ends at TLS termination;
- gateway can see plaintext;
- message forwarded downstream mungkin tidak lagi protected;
- tidak memberikan object-level signature di SOAP payload.

### 20.2 WS-Security / message security

WS-Security melindungi message:

```xml
<soap:Header>
  <wsse:Security>
    <wsu:Timestamp>...</wsu:Timestamp>
    <ds:Signature>...</ds:Signature>
    <xenc:EncryptedData>...</xenc:EncryptedData>
  </wsse:Security>
</soap:Header>
```

Kelebihan:

- message remains signed across intermediaries;
- supports non-repudiation style scenarios;
- can sign/encrypt selected body/header parts;
- useful for store-and-forward or multi-hop.

Keterbatasan:

- complex;
- canonicalization-sensitive;
- vulnerable to misconfiguration;
- painful interop;
- performance cost;
- requires strong clock/key/cert management.

Rule:

```text
TLS secures the pipe.
WS-Security secures the message.
```

Dalam regulated integration, kadang keduanya dipakai.

---

## 21. SOAP Reliability Semantics

SOAP sendiri bukan magic reliability solution. Ia menyediakan message structure. Reliability tergantung:

- transport;
- retry policy;
- idempotency;
- WS-ReliableMessaging jika digunakan;
- application-level duplicate handling;
- timeout semantics;
- transaction boundary.

### 21.1 Request-response ambiguity

Contoh:

```text
Client sends CreateCase
Server creates case
Network timeout before response reaches client
Client retries CreateCase
```

Apa yang terjadi?

Buruk:

```text
Two cases created
```

Baik:

```text
Client sends idempotency key / external reference
Server detects duplicate
Returns same caseId or duplicate-safe response
```

SOAP tidak menghapus problem distributed systems.

### 21.2 Idempotency contract

Untuk operasi mutasi:

```xml
<CreateCaseRequest>
  <RequestId>REQ-2026-00001</RequestId>
  <ExternalReference>APP-123</ExternalReference>
  ...
</CreateCaseRequest>
```

Atau lewat Header:

```xml
<soap:Header>
  <idempotency:Key>REQ-2026-00001</idempotency:Key>
</soap:Header>
```

Jika kontrak tidak punya idempotency key, retry harus sangat hati-hati.

---

## 22. SOAP dan Transaction: Jangan Salah Membayangkan

SOAP request tidak otomatis berarti distributed transaction.

Skenario:

```text
System A calls SOAP System B
System B updates DB
System A updates DB
Network fails
```

Tanpa transaction coordination, tidak ada atomicity lintas sistem.

Beberapa enterprise stack historically memakai WS-AtomicTransaction, XA, atau middleware transaction, tetapi itu kompleks dan jarang nyaman di modern microservice architecture.

Prinsip modern:

```text
Prefer explicit business compensation over distributed transaction across SOAP boundaries.
```

Contoh:

- `submitApplication`;
- jika downstream gagal, mark `PENDING_EXTERNAL_SYNC`;
- retry async;
- expose reconciliation status;
- provide `cancelSubmission` jika business memungkinkan.

---

## 23. SOAP Contract Design: Operation-Centric vs Document-Centric

SOAP bisa didesain operation-centric:

```text
createCase(applicantId, caseType)
approveCase(caseId)
rejectCase(caseId, reason)
```

Atau document-centric:

```text
SubmitCaseDocument
UpdateCaseStateDocument
AcknowledgeCaseSubmissionDocument
```

Operation-centric mudah untuk generated clients. Document-centric sering lebih stabil untuk enterprise document flow.

### 23.1 Operation-centric cocok jika

- service internal;
- operation lifecycle jelas;
- parameter kecil;
- tooling method proxy diutamakan;
- consumer sedikit dan controlled.

### 23.2 Document-centric cocok jika

- payload kompleks;
- ada schema governance;
- consumer banyak;
- payload hidup lebih lama dari service method;
- message bisa disimpan/audit/replayed;
- integration lintas organisasi.

Dalam regulated systems, document-centric sering lebih defensible.

---

## 24. SOAP in Java: API Layer Map

Untuk Java engineer, SOAP landscape perlu dipetakan.

```text
SOAP Conceptual Layer
├── SOAP spec              -> envelope/header/body/fault
├── WSDL/XSD               -> service contract
├── JAXB/XML Binding       -> XML <-> Java object
├── JAX-WS/XML Web Services-> service/client programming model
├── SAAJ/SOAP Attachments  -> low-level SOAP message API
├── Handler chain          -> intercept message/protocol
├── WS-* libraries         -> security/addressing/policy/etc
└── Container/runtime      -> app server, Metro, CXF, JBossWS, etc.
```

### 24.1 JAXB role

JAXB maps XML payload inside body/detail to Java objects.

```text
SOAP Body XML <-> JAXB DTO
```

### 24.2 JAX-WS role

JAX-WS maps WSDL operations to Java endpoints/clients.

```text
WSDL operation <-> Java method
SOAP message   <-> invocation
```

### 24.3 SAAJ role

SAAJ lets you manually create/manipulate SOAP messages.

```text
SOAPMessage
├── SOAPPart
│   └── SOAPEnvelope
│       ├── SOAPHeader
│       └── SOAPBody
└── AttachmentPart*
```

Use SAAJ when:

- you need low-level message manipulation;
- custom legacy SOAP not fitting generated JAX-WS client;
- attachment handling;
- debugging/testing;
- gateway/facade transformation.

Do not use SAAJ as default for all SOAP integration if WSDL/JAX-WS works cleanly.

---

## 25. Java 8 to 25 Compatibility Mental Model

### 25.1 Java 8

Historically, many Java EE XML/SOAP APIs were available in the JDK or expected by legacy stacks:

- JAXB API/runtime behavior was commonly assumed;
- JAX-WS tooling such as `wsimport`/`wsgen` was commonly assumed;
- SAAJ was commonly available in Java EE/JDK ecosystem.

Many old projects accidentally depended on JDK-bundled Java EE modules.

### 25.2 Java 9/10

Modules introduced complexity. Java EE modules were deprecated for removal.

### 25.3 Java 11+

OpenJDK removed Java EE/CORBA modules via JEP 320. This includes commonly relied-on modules such as JAXB/JAX-WS related modules.

Practical consequence:

```text
Do not assume JAXB/JAX-WS/SAAJ are in the JDK.
Declare dependencies explicitly.
Declare tools explicitly.
Choose javax vs jakarta line deliberately.
```

### 25.4 javax vs jakarta namespace

Older APIs:

```java
javax.xml.bind.JAXBContext
javax.jws.WebService
javax.xml.ws.Service
javax.xml.soap.SOAPMessage
```

Jakarta APIs:

```java
jakarta.xml.bind.JAXBContext
jakarta.jws.WebService
jakarta.xml.ws.Service
jakarta.xml.soap.SOAPMessage
```

You cannot casually mix them.

If generated classes use `javax.xml.bind.annotation.*`, they are not the same API as `jakarta.xml.bind.annotation.*`.

Migration must align:

```text
Generated sources
Runtime API
Implementation
Application server
Framework integration
Build plugins/tools
```

### 25.5 Jakarta EE 11 platform note

Jakarta EE 11 removed XML Binding, XML Web Services, and SOAP with Attachments from the platform. That does not mean the specs vanish from all usage, but it means you should treat them as explicit dependencies/runtime choices rather than assuming every Jakarta EE 11 platform includes them.

---

## 26. SOAP Debugging Mental Model

When SOAP breaks, junior engineers often start from Java stack trace. Senior engineers start from wire contract.

### 26.1 Debug order

```text
1. Is HTTP request reaching the right endpoint?
2. Is HTTP method correct? Usually POST.
3. Is Content-Type correct for SOAP version?
4. Is SOAPAction/action correct?
5. Is envelope namespace correct?
6. Are header namespaces/roles/mustUnderstand correct?
7. Does body wrapper QName match WSDL?
8. Does payload validate against XSD?
9. Does server return SOAP Fault or non-SOAP error?
10. Does generated Java binding match actual WSDL/XSD?
11. Are timeouts/retries/idempotency configured safely?
```

### 26.2 Capture raw message

Always try to capture:

```text
Raw HTTP request headers
Raw HTTP request body
Raw HTTP response headers
Raw HTTP response body
```

Without raw messages, SOAP debugging becomes guesswork.

### 26.3 Common tool choices

- `curl` for simple POST tests;
- SoapUI for WSDL-driven tests;
- Postman for simple SOAP calls;
- tcpdump/mitmproxy in lower env if allowed;
- JAX-WS logging flags;
- server access logs;
- gateway logs;
- XML validation tools;
- WSDL/XSD diff.

---

## 27. SOAP Payload Validation Strategy

In production-grade SOAP integration, validation can happen at several layers:

```text
Client-side schema validation
Gateway schema validation
Server-side SOAP runtime validation
Application-level validation
Database/business invariant validation
```

### 27.1 Schema validation catches structural issues

Examples:

- missing required element;
- wrong order in `xs:sequence`;
- invalid enum;
- invalid date format;
- element in wrong namespace;
- unexpected element.

### 27.2 Schema validation does not catch all business rules

Example XSD may allow:

```xml
<amount>1000</amount>
<status>CLOSED</status>
```

But business may reject because:

```text
Cannot close case while enforcement action is pending.
```

So validation layers are complementary.

```text
XSD = structural validity
Business validation = domain validity
Security validation = authorization/context validity
```

---

## 28. SOAP vs REST Decision Matrix

SOAP is not always wrong. REST is not always better. The right choice depends on constraints.

| Situation | SOAP may fit | REST/JSON may fit |
|---|---|---|
| Existing external partner exposes WSDL | Yes | As facade only |
| Formal schema-first contract required | Strong | Possible with OpenAPI/JSON Schema, but different maturity |
| Message-level security/signature across intermediaries | Strong via WS-Security | Possible but custom/JWS/etc |
| Browser/mobile client | Poor | Strong |
| Public developer API | Usually poor | Strong |
| Enterprise legacy interop | Strong | Depends |
| Simple CRUD resource API | Heavy | Strong |
| Payload is XML document already | Strong | Maybe unnecessary conversion |
| Need generated strongly typed client across enterprise stacks | Strong historically | Possible with OpenAPI tooling |
| Need low friction developer experience | Often poor | Strong |

Practical conclusion:

```text
Use SOAP when contract/interoperability/security legacy constraints require it.
Use REST/JSON when resource model, simplicity, web compatibility, and developer ergonomics dominate.
Use a facade/anti-corruption layer when modern systems must integrate with SOAP legacy.
```

---

## 29. SOAP Anti-Patterns

### 29.1 Treating SOAP as string concatenation

Bad:

```java
String xml = "<Envelope><Body><x>" + userInput + "</x></Body></Envelope>";
```

Risks:

- XML injection;
- invalid escaping;
- namespace bugs;
- encoding bugs;
- impossible maintainability.

Better:

- generated JAXB model;
- SAAJ/DOM/StAX carefully;
- XML escaping;
- schema validation;
- controlled templates only if unavoidable.

### 29.2 Ignoring namespaces

Bad:

```java
if (element.getLocalName().equals("CreateCaseRequest")) { ... }
```

Better:

```java
QName expected = new QName("urn:example:case:v1", "CreateCaseRequest");
```

### 29.3 Mapping every SOAP fault to generic 500

Bad facade:

```json
{ "error": "SOAP error" }
```

Better facade:

```json
{
  "errorCode": "CASE-VAL-001",
  "message": "Applicant ID is required",
  "upstreamFaultCode": "Client",
  "correlationId": "REQ-2026-00001"
}
```

### 29.4 Blind retry on mutating operations

Bad:

```text
Timeout -> retry CreatePayment 3 times
```

Better:

```text
Timeout -> query by idempotency key/external reference -> retry only if safe
```

### 29.5 Regenerating clients without contract review

Bad:

```text
WSDL changed -> run wsimport -> commit generated diff blindly
```

Better:

```text
WSDL changed -> diff contract -> classify breaking/non-breaking -> regenerate -> run compatibility tests
```

### 29.6 Exposing internal SOAP model directly as modern API

Bad:

```text
Mobile App -> REST facade -> exposes SOAP-generated DTO shape directly
```

Result:

- weird XML-era names leak into frontend;
- nillable semantics leak;
- SOAP fault codes leak;
- internal partner contract becomes public API.

Better:

```text
Mobile App -> Modern API DTO -> anti-corruption mapper -> SOAP DTO -> SOAP service
```

---

## 30. SOAP Modernization Mental Model

SOAP modernization is not simply “convert XML to JSON”.

It requires preserving or translating:

- operation semantics;
- idempotency;
- fault taxonomy;
- security model;
- correlation/audit fields;
- schema constraints;
- timeout/retry semantics;
- upstream availability behavior;
- regulatory evidence;
- compatibility commitments.

### 30.1 Facade pattern

```text
Modern Client
  -> REST/JSON API
      -> Anti-Corruption Layer
          -> SOAP Client
              -> Legacy SOAP System
```

Facade responsibilities:

- map modern DTO to SOAP request;
- map SOAP response to modern DTO;
- map SOAP Fault to modern error model;
- enforce idempotency;
- normalize timeout/retry;
- isolate generated SOAP classes;
- log correlation safely;
- validate both modern and SOAP contracts.

### 30.2 Strangler pattern

```text
Phase 1: REST facade calls SOAP backend
Phase 2: Some operations reimplemented in new service
Phase 3: Legacy SOAP calls shrink
Phase 4: SOAP retired or kept only for external partners
```

Important: do not break external contract until consumers migrate.

---

## 31. SOAP Mental Model for Regulatory/Case Management Systems

Untuk sistem enforcement/case management, SOAP sering muncul di:

- identity/profile lookup;
- document submission;
- payment/receipt integration;
- licensing registry;
- external agency notification;
- case status synchronization;
- file transfer metadata;
- legacy workflow system;
- government-to-government integration.

Dalam konteks ini, SOAP message harus diperlakukan sebagai evidence-bearing artifact.

Pertanyaan desain:

```text
Can we prove what was sent?
Can we prove what was received?
Can we replay safely?
Can we correlate message to case/application?
Can we distinguish validation failure from upstream outage?
Can we preserve original payload for audit without leaking secrets?
Can we handle duplicate response or delayed response?
Can we migrate Java/Jakarta versions without changing external contract?
```

SOAP contract bukan hanya developer convenience. Ia bagian dari lifecycle integrasi.

---

## 32. Example: Reading a SOAP Integration Like an Architect

Misal ada service:

```text
CaseNotificationService.notifyCaseStatus
```

Request:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:case="urn:agency:case:v1">
  <soapenv:Header>
    <case:CorrelationId soapenv:mustUnderstand="1">REQ-100</case:CorrelationId>
    <case:ClientId>ACEAS</case:ClientId>
  </soapenv:Header>
  <soapenv:Body>
    <case:NotifyCaseStatusRequest>
      <case:caseId>C-001</case:caseId>
      <case:newStatus>CLOSED</case:newStatus>
      <case:effectiveDate>2026-06-17</case:effectiveDate>
    </case:NotifyCaseStatusRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

Architectural questions:

1. Is `NotifyCaseStatusRequest` schema-first or generated from Java?
2. Is `caseId` globally unique or only local?
3. Is notification idempotent?
4. If timeout occurs, can we query status by correlation ID?
5. Is `CorrelationId` really understood by receiver, given `mustUnderstand=1`?
6. What happens if `newStatus` is unknown to older receiver?
7. Is date timezone-free intentionally?
8. Is `CLOSED` an enum in XSD?
9. Are faults modeled?
10. Is SOAPAction required?
11. Does receiver validate XSD?
12. Are raw payloads stored? If yes, are secrets redacted/encrypted?
13. Does message need digital signature?
14. Is retry safe?
15. Who owns the WSDL?

This is the difference between “I can call SOAP” and “I can own SOAP integration”.

---

## 33. Minimal Java/SAAJ Example for Mental Model

Implementation detail comes later, but a small SAAJ example helps connect concept to API.

Jakarta namespace example:

```java
import jakarta.xml.soap.MessageFactory;
import jakarta.xml.soap.SOAPBody;
import jakarta.xml.soap.SOAPConnection;
import jakarta.xml.soap.SOAPConnectionFactory;
import jakarta.xml.soap.SOAPEnvelope;
import jakarta.xml.soap.SOAPHeader;
import jakarta.xml.soap.SOAPMessage;
import jakarta.xml.soap.SOAPPart;

import javax.xml.namespace.QName;
import java.net.URL;

public class MinimalSoapClient {

    public static void main(String[] args) throws Exception {
        MessageFactory messageFactory = MessageFactory.newInstance();
        SOAPMessage message = messageFactory.createMessage();

        SOAPPart soapPart = message.getSOAPPart();
        SOAPEnvelope envelope = soapPart.getEnvelope();
        envelope.addNamespaceDeclaration("case", "urn:example:case:v1");

        SOAPHeader header = envelope.getHeader();
        QName correlationName = new QName("urn:example:case:v1", "CorrelationId", "case");
        header.addHeaderElement(correlationName)
                .addTextNode("REQ-2026-00001");

        SOAPBody body = envelope.getBody();
        QName requestName = new QName("urn:example:case:v1", "CreateCaseRequest", "case");
        var request = body.addBodyElement(requestName);
        request.addChildElement("applicantId", "case").addTextNode("A123");
        request.addChildElement("caseType", "case").addTextNode("ENFORCEMENT");

        message.saveChanges();

        SOAPConnectionFactory connectionFactory = SOAPConnectionFactory.newInstance();
        SOAPConnection connection = connectionFactory.createConnection();

        SOAPMessage response = connection.call(message, new URL("https://example.internal/CaseService"));
        response.writeTo(System.out);

        connection.close();
    }
}
```

Important notes:

1. This is low-level and not always best for production WSDL-based integration.
2. Generated JAX-WS clients are often better for contract-first SOAP.
3. SAAJ is useful to understand message anatomy and handle special cases.
4. With Java 11+, dependencies must be explicit.
5. With Jakarta APIs, package names are `jakarta.*`, not `javax.*`.

---

## 34. SOAP Mental Checklist

Saat melihat SOAP integration, baca dengan urutan ini:

```text
Contract
[ ] WSDL owner jelas?
[ ] XSD schema version jelas?
[ ] Operation style/use jelas?
[ ] SOAP 1.1/1.2 jelas?
[ ] Fault contract jelas?

Message
[ ] Envelope namespace benar?
[ ] Header mandatory diproses?
[ ] Body wrapper QName benar?
[ ] Namespace payload benar?
[ ] SOAPAction/action benar?

Runtime
[ ] JAX-WS/SAAJ/JAXB dependency eksplisit?
[ ] javax/jakarta konsisten?
[ ] Generated code reproducible?
[ ] Timeouts eksplisit?
[ ] Retry safe?
[ ] Logging raw payload aman?

Security
[ ] TLS boundary jelas?
[ ] Message-level signature/encryption diperlukan?
[ ] Timestamp/replay protection ada?
[ ] Secrets tidak bocor ke log?
[ ] Parser XML hardened?

Reliability
[ ] Idempotency key ada?
[ ] Duplicate handling ada?
[ ] Fault taxonomy dipetakan?
[ ] Upstream timeout behavior jelas?
[ ] Reconciliation path ada?
```

---

## 35. Ringkasan Mental Model

SOAP harus dipahami sebagai:

```text
A structured XML message envelope
with standard processing rules
for metadata, payload, and faults
bound to transports such as HTTP
and usually governed by WSDL/XSD contracts.
```

Hal yang paling penting:

1. SOAP bukan sekadar XML over HTTP.
2. Envelope menentukan SOAP version dan message boundary.
3. Header adalah extensibility layer untuk cross-cutting metadata.
4. `mustUnderstand` mencegah metadata penting diabaikan diam-diam.
5. Body membawa payload bisnis atau Fault.
6. Fault adalah error contract, bukan tempat stack trace mentah.
7. SOAP 1.1 dan SOAP 1.2 berbeda secara nyata.
8. WSDL/XSD adalah pusat kontrak SOAP integration.
9. Document/literal lebih modern dan interoperable daripada rpc/encoded.
10. SOAP-over-HTTP punya dua layer status: HTTP dan SOAP Fault.
11. Java 11+ membutuhkan dependency eksplisit untuk JAXB/JAX-WS/SAAJ ecosystem.
12. javax→jakarta migration harus konsisten.
13. SOAP modernization memerlukan anti-corruption layer, bukan sekadar XML-to-JSON converter.

---

## 36. Apa yang Akan Dibahas di Part 23

Part berikutnya adalah:

# Part 23 — WSDL Deep Dive

Kita akan membahas:

1. struktur WSDL;
2. `types`, `message`, `portType`, `binding`, `service`;
3. SOAP binding;
4. WSDL import/include;
5. XSD modularization;
6. operation style/use;
7. fault contract;
8. endpoint address;
9. compatibility evolution;
10. bagaimana membaca WSDL seperti contract architect.

Status seri: **belum selesai**. Part ini adalah **Part 22 dari 34**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — JAXB Runtime, Performance & Migration](./learn-java-json-xml-soap-connectors-enterprise-integration-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — WSDL Deep Dive: Contract, Types, Messages, Port Types, Bindings, Services, and Evolution](./learn-java-json-xml-soap-connectors-enterprise-integration-part-023.md)
