# learn-java-json-xml-soap-connectors-enterprise-integration — Part 24
# JAX-WS / Jakarta XML Web Services Server Side

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Part: `024`  
> Topik: server-side SOAP service dengan JAX-WS / Jakarta XML Web Services  
> Target Java: Java 8 sampai Java 25  
> Target pembaca: engineer Java backend/enterprise yang ingin mampu merancang, memelihara, memigrasikan, dan men-debug SOAP service secara production-grade.

---

## 0. Posisi Part Ini dalam Seri

Sebelumnya kita sudah membangun fondasi:

- XML sebagai infoset, namespace, QName, dan dokumen berstruktur.
- XSD sebagai kontrak formal untuk bentuk data.
- JAXB / Jakarta XML Binding sebagai mekanisme binding XML ↔ Java.
- SOAP sebagai message protocol dengan envelope, header, body, dan fault.
- WSDL sebagai kontrak service yang menggabungkan schema, operation, binding, dan endpoint.

Sekarang kita masuk ke sisi server: bagaimana sebuah Java application mengekspos SOAP endpoint memakai JAX-WS / Jakarta XML Web Services.

Di banyak sistem modern, topik ini tampak legacy. Tetapi di enterprise nyata, SOAP masih muncul di area:

- government-to-government integration,
- banking dan payment,
- insurance,
- telco,
- document exchange,
- enterprise service bus lama,
- middleware vendor,
- sistem dengan kontrak XSD/WSDL yang sudah stabil bertahun-tahun,
- integrasi yang membutuhkan WS-Security, message-level signature, atau auditability kuat.

Top 1% engineer tidak melihat JAX-WS sebagai sekadar annotation `@WebService`. Mereka melihatnya sebagai:

```text
WSDL/XSD contract
        ↓
Java endpoint model
        ↓
JAXB binding
        ↓
SOAP runtime
        ↓
Servlet/container transport
        ↓
handler/interceptor/security/transaction boundary
        ↓
operational behavior: compatibility, fault, timeout, logging, observability
```

Part ini fokus pada sisi server. Client-side akan dibahas di Part 25.

---

## 1. Istilah dan Versi: JAX-WS, Jakarta XML Web Services, Javax, Jakarta

### 1.1 Nama lama dan nama baru

Secara historis, API ini dikenal sebagai **JAX-WS**: Java API for XML Web Services.

Pada era Jakarta, spesifikasi ini bernama **Jakarta XML Web Services**. Package berubah dari:

```java
javax.xml.ws.*
javax.jws.*
javax.jws.soap.*
```

menjadi:

```java
jakarta.xml.ws.*
jakarta.jws.*
jakarta.jws.soap.*
```

Mental modelnya tetap mirip, tetapi namespace package berubah besar.

### 1.2 Hubungan dengan spesifikasi lain

Jakarta XML Web Services tidak berdiri sendiri. Ia bergantung pada beberapa spesifikasi/komponen:

| Layer | Peran |
|---|---|
| WSDL | kontrak service |
| XSD | kontrak struktur data |
| JAXB / Jakarta XML Binding | mapping XML ↔ Java object |
| SAAJ / Jakarta SOAP with Attachments | model/manipulasi SOAP message |
| Jakarta Web Services Metadata | annotation seperti `@WebService`, `@WebMethod`, `@WebParam`, `@WebResult`, `@HandlerChain` |
| Servlet/Jakarta Servlet | transport HTTP di banyak deployment |
| Container/runtime | GlassFish, Payara, WebLogic, WildFly/JBossWS, Metro, CXF, Liberty, dan lain-lain |

Jadi saat sebuah endpoint gagal, penyebabnya bisa berada di banyak layer: WSDL mismatch, JAXB binding, namespace, SOAP binding, handler, servlet mapping, classloader, dependency, atau security policy.

### 1.3 Java 8 sampai Java 25: perubahan paling penting

Pada Java 8, JAX-WS/JAXB/SAAJ masih sering dianggap “bawaan JDK”. Tetapi sejak Java 11, modul Java EE dan CORBA dihapus dari JDK berdasarkan JEP 320. Modul seperti `java.xml.ws` dan `java.xml.bind` tidak lagi tersedia di JDK 11+. Artinya, untuk Java 11 sampai Java 25, dependency API dan runtime harus eksplisit.

Konsekuensi praktis:

| Target | Implikasi |
|---|---|
| Java 8 legacy | Banyak aplikasi masih compile karena API tersedia dari JDK atau app server lama. Risiko: hidden dependency. |
| Java 9/10 | Modul deprecated-for-removal. Masa transisi. |
| Java 11+ | JAXB/JAX-WS/SAAJ tidak bundled. Harus pakai dependency eksternal / container support. |
| Java 17/21/25 | Harus jelas memilih `javax` legacy stack atau `jakarta` stack. Jangan campur sembarang. |

### 1.4 Jakarta EE 11 caveat

Jakarta XML Web Services, Jakarta XML Binding, dan Jakarta SOAP with Attachments tidak lagi menjadi bagian dari Jakarta EE 11 platform utama. Ini bukan berarti teknologinya hilang dari dunia Java, tetapi engineer harus sadar bahwa:

- support bisa datang dari implementation/vendor tertentu,
- aplikasi modern mungkin perlu membawa dependency eksplisit,
- server/container mungkin tidak otomatis menyediakan semua API,
- migrasi ke runtime Jakarta EE 11 perlu assessment khusus untuk SOAP/JAXB workload.

---

## 2. Apa yang Sebenarnya Dilakukan JAX-WS Server?

JAX-WS server-side bukan hanya “menerima XML”. Ia melakukan pipeline ini:

```text
HTTP request
  ↓
Servlet/container endpoint mapping
  ↓
SOAP envelope parse
  ↓
SOAP version and binding validation
  ↓
handler chain inbound
  ↓
WS-* processing/security/runtime policy
  ↓
operation dispatch
  ↓
JAXB unmarshalling body payload to Java parameters
  ↓
endpoint method invocation
  ↓
business/service layer call
  ↓
return value or exception
  ↓
JAXB marshalling to XML
  ↓
SOAP response or SOAP fault
  ↓
handler chain outbound
  ↓
HTTP response
```

Setiap step punya failure mode.

Contoh:

| Step | Failure |
|---|---|
| HTTP mapping | 404, wrong servlet mapping, wrong context path |
| SOAP parsing | malformed XML, wrong SOAP namespace |
| handler inbound | auth failure, invalid header, missing correlation ID |
| operation dispatch | SOAPAction mismatch, body element mismatch, namespace mismatch |
| JAXB unmarshalling | unexpected element, invalid date, nillable mismatch, missing no-arg constructor |
| endpoint invocation | domain validation failure, downstream timeout |
| marshalling | cyclic object graph, invalid XML char, namespace error |
| fault mapping | Java exception leaked as generic server fault |
| outbound handler | signature/logging/transform failure |

Top engineer men-debug SOAP endpoint dengan melihat pipeline ini, bukan hanya stack trace terakhir.

---

## 3. Dua Pendekatan Besar: Contract-First vs Code-First

### 3.1 Contract-first

Contract-first berarti WSDL/XSD dianggap sebagai sumber kebenaran. Java code digenerate atau ditulis agar mengikuti kontrak.

```text
WSDL/XSD
  ↓ wsimport / code generation
SEI + JAXB model
  ↓ implementation
Endpoint implementation
```

Cocok untuk:

- integrasi antar organisasi,
- kontrak yang sudah disepakati legal/operasional,
- sistem lama yang consumer-nya banyak,
- domain dengan strict schema,
- SOAP service yang harus kompatibel lintas platform (.NET, Oracle, SAP, IBM, ESB, legacy client).

Keuntungan:

- kontrak stabil,
- consumer tidak tergantung detail Java,
- schema dapat direview sebelum implementasi,
- compatibility bisa dites lewat WSDL/XSD,
- mengurangi accidental contract drift.

Risiko:

- generated code bisa kompleks,
- XSD design buruk akan masuk ke Java model,
- butuh disiplin build tooling,
- perubahan kontrak lebih formal.

### 3.2 Code-first

Code-first berarti Java class/annotation menjadi sumber awal. Runtime/tool menghasilkan WSDL dari code.

```text
Java endpoint class
  ↓ annotations
Generated WSDL/XSD
  ↓ published contract
Consumer integration
```

Cocok untuk:

- internal service kecil,
- prototyping,
- service dengan sedikit consumer,
- service yang lifecycle-nya dikontrol satu tim,
- migration facade sementara.

Risiko besar:

- rename method mengubah operation,
- rename class/package mengubah namespace default,
- refactor DTO mengubah schema,
- overload/generic/collection mapping tidak selalu intuitif,
- WSDL berubah karena update runtime/vendor,
- consumer bisa break tanpa engineer sadar.

### 3.3 Rule of thumb

Untuk enterprise SOAP external boundary:

```text
External SOAP contract → contract-first.
Internal temporary SOAP endpoint → code-first boleh, tapi freeze WSDL cepat.
```

Jika endpoint sudah dikonsumsi pihak lain, treat WSDL sebagai artifact versioned, bukan output sementara.

---

## 4. Anatomy Minimal JAX-WS Endpoint

### 4.1 Javax version untuk legacy Java EE / Java 8 style

```java
package com.acme.payment.soap;

import javax.jws.WebMethod;
import javax.jws.WebParam;
import javax.jws.WebResult;
import javax.jws.WebService;
import javax.jws.soap.SOAPBinding;

@WebService(
    name = "PaymentPortType",
    serviceName = "PaymentService",
    portName = "PaymentPort",
    targetNamespace = "urn:acme:payment:v1"
)
@SOAPBinding(
    style = SOAPBinding.Style.DOCUMENT,
    use = SOAPBinding.Use.LITERAL,
    parameterStyle = SOAPBinding.ParameterStyle.WRAPPED
)
public class PaymentEndpoint {

    @WebMethod(operationName = "SubmitPayment")
    @WebResult(name = "SubmitPaymentResponse")
    public SubmitPaymentResponse submitPayment(
        @WebParam(name = "SubmitPaymentRequest") SubmitPaymentRequest request
    ) {
        // call application service
        SubmitPaymentResponse response = new SubmitPaymentResponse();
        response.setStatus("ACCEPTED");
        return response;
    }
}
```

### 4.2 Jakarta version untuk Jakarta namespace

```java
package com.acme.payment.soap;

import jakarta.jws.WebMethod;
import jakarta.jws.WebParam;
import jakarta.jws.WebResult;
import jakarta.jws.WebService;
import jakarta.jws.soap.SOAPBinding;

@WebService(
    name = "PaymentPortType",
    serviceName = "PaymentService",
    portName = "PaymentPort",
    targetNamespace = "urn:acme:payment:v1"
)
@SOAPBinding(
    style = SOAPBinding.Style.DOCUMENT,
    use = SOAPBinding.Use.LITERAL,
    parameterStyle = SOAPBinding.ParameterStyle.WRAPPED
)
public class PaymentEndpoint {

    @WebMethod(operationName = "SubmitPayment")
    @WebResult(name = "SubmitPaymentResponse")
    public SubmitPaymentResponse submitPayment(
        @WebParam(name = "SubmitPaymentRequest") SubmitPaymentRequest request
    ) {
        SubmitPaymentResponse response = new SubmitPaymentResponse();
        response.setStatus("ACCEPTED");
        return response;
    }
}
```

Perbedaannya tampak kecil: `javax` vs `jakarta`. Tetapi secara binary compatibility, ini dunia berbeda.

---

## 5. Annotation Utama dan Maknanya

### 5.1 `@WebService`

`@WebService` menandai class atau interface sebagai web service endpoint / service endpoint interface.

Atribut umum:

| Atribut | Makna |
|---|---|
| `name` | nama port type / SEI contract |
| `targetNamespace` | namespace WSDL/XML contract |
| `serviceName` | nama WSDL service |
| `portName` | nama WSDL port |
| `endpointInterface` | class implementasi menunjuk ke SEI eksplisit |
| `wsdlLocation` | lokasi WSDL statis |

Contoh:

```java
@WebService(
    name = "CaseExchangePortType",
    targetNamespace = "urn:gov:case-exchange:v1",
    serviceName = "CaseExchangeService",
    portName = "CaseExchangePort"
)
public class CaseExchangeEndpoint {
}
```

Mental model:

```text
@WebService bukan sekadar marker.
Ia menentukan identitas kontrak.
```

Jika `targetNamespace` tidak eksplisit, runtime bisa membuat namespace default dari package Java. Ini berbahaya untuk kontrak eksternal karena refactor package bisa mengubah WSDL.

### 5.2 `@WebMethod`

`@WebMethod` mengontrol exposure method sebagai operation.

```java
@WebMethod(operationName = "SubmitCase")
public SubmitCaseResponse submitCase(SubmitCaseRequest request) {
    ...
}
```

Gunakan `operationName` eksplisit untuk mencegah rename Java method mengubah operation contract.

Untuk menyembunyikan public method:

```java
@WebMethod(exclude = true)
public void internalHelper() {
}
```

Rule:

```text
Public helper method tidak boleh berada di endpoint class kecuali di-exclude.
Lebih baik endpoint class tipis dan hanya berisi operation public.
```

### 5.3 `@WebParam`

`@WebParam` mengontrol nama parameter dalam message.

```java
public SubmitCaseResponse submitCase(
    @WebParam(name = "SubmitCaseRequest") SubmitCaseRequest request
) {
    ...
}
```

Tanpa `@WebParam`, runtime bisa memakai nama seperti `arg0` jika parameter name tidak tersedia atau tidak dipertahankan saat compile.

Ini salah satu sumber WSDL jelek:

```xml
<xs:element name="arg0" type="tns:SubmitCaseRequest"/>
```

Untuk kontrak profesional, jangan biarkan `arg0` bocor ke WSDL.

### 5.4 `@WebResult`

`@WebResult` mengontrol nama return value.

```java
@WebResult(name = "SubmitCaseResponse")
public SubmitCaseResponse submitCase(...) {
    ...
}
```

Tanpa ini, hasil response bisa mendapat nama default yang tidak sesuai naming convention kontrak.

### 5.5 `@SOAPBinding`

`@SOAPBinding` mengontrol style/use/parameterStyle.

Pilihan umum:

```java
@SOAPBinding(
    style = SOAPBinding.Style.DOCUMENT,
    use = SOAPBinding.Use.LITERAL,
    parameterStyle = SOAPBinding.ParameterStyle.WRAPPED
)
```

Penjelasan:

| Property | Umum Dipakai | Catatan |
|---|---|---|
| `style` | `DOCUMENT` | Service message berbasis dokumen XML. |
| `use` | `LITERAL` | Payload mengikuti XSD literal, bukan SOAP encoding lama. |
| `parameterStyle` | `WRAPPED` | Request/response dibungkus element operation wrapper. |

Untuk interoperability modern, **document/literal wrapped** biasanya paling aman.

Hindari RPC/encoded untuk kontrak baru. RPC/encoded legacy sering bermasalah lintas vendor dan bukan pola modern WS-I Basic Profile.

### 5.6 `@HandlerChain`

`@HandlerChain` menghubungkan endpoint dengan handler chain XML.

```java
@WebService(...)
@HandlerChain(file = "handler-chain.xml")
public class CaseExchangeEndpoint {
}
```

Handler chain dipakai untuk cross-cutting concern seperti:

- correlation ID,
- audit logging,
- SOAP header validation,
- authentication token extraction,
- message signature hook,
- custom routing metadata,
- masking sensitive log fields.

Namun handler bukan tempat ideal untuk business logic.

---

## 6. Service Endpoint Interface / SEI

### 6.1 Kenapa SEI penting?

SEI memisahkan kontrak service dari implementasi.

```java
@WebService(
    name = "CaseExchangePortType",
    targetNamespace = "urn:gov:case-exchange:v1"
)
public interface CaseExchangePort {

    @WebMethod(operationName = "SubmitCase")
    @WebResult(name = "SubmitCaseResponse")
    SubmitCaseResponse submitCase(
        @WebParam(name = "SubmitCaseRequest") SubmitCaseRequest request
    ) throws CaseExchangeFault;
}
```

Implementasi:

```java
@WebService(
    serviceName = "CaseExchangeService",
    portName = "CaseExchangePort",
    targetNamespace = "urn:gov:case-exchange:v1",
    endpointInterface = "com.acme.caseexchange.soap.CaseExchangePort"
)
public class CaseExchangeEndpoint implements CaseExchangePort {

    private final CaseApplicationService service;

    public CaseExchangeEndpoint() {
        this.service = ServiceLocator.caseApplicationService();
    }

    @Override
    public SubmitCaseResponse submitCase(SubmitCaseRequest request) throws CaseExchangeFault {
        return service.submit(request);
    }
}
```

Keuntungan SEI:

- kontrak lebih eksplisit,
- implementasi bisa diganti tanpa mengubah interface,
- generated WSDL lebih stabil,
- testing lebih mudah,
- mengurangi accidental exposure public method,
- lebih cocok untuk contract-first generated code.

### 6.2 Endpoint implementation class sebaiknya tipis

Endpoint class bukan tempat business orchestration besar. Ia adalah adapter.

```text
SOAP endpoint
  = transport/protocol adapter
  ≠ domain service
```

Struktur ideal:

```text
CaseExchangeEndpoint
  ↓ maps SOAP DTO / validates protocol boundary
CaseApplicationService
  ↓ business use case
Domain services / repositories / external clients
```

Jika endpoint class mengandung query database, branching domain, retry downstream, parsing manual, dan audit logic sekaligus, maka integrasi akan sulit dites, sulit dimigrasikan, dan rawan coupling ke SOAP.

---

## 7. Endpoint Design: Operation Shape yang Stabil

### 7.1 Prefer one request object and one response object

Untuk SOAP enterprise, hindari method dengan banyak parameter primitif:

```java
// Kurang ideal untuk kontrak jangka panjang
public SubmitResponse submit(String caseNo, String applicantId, BigDecimal amount, String type) { ... }
```

Lebih stabil:

```java
public SubmitCaseResponse submitCase(SubmitCaseRequest request) { ... }
```

Kenapa?

- mudah menambah field optional,
- XSD lebih natural,
- request dapat divalidasi sebagai dokumen,
- audit log lebih rapi,
- lebih mudah versioning,
- lebih konsisten dengan document/literal style.

### 7.2 Jangan expose domain entity langsung

Buruk:

```java
@WebMethod
public CaseEntity submitCase(CaseEntity entity) { ... }
```

Masalah:

- domain refactor mengubah kontrak,
- lazy field/proxy bisa bocor,
- field internal bisa muncul di XML,
- schema menjadi bayangan persistence model,
- consumer terikat ke internal invariant.

Lebih baik:

```java
@WebMethod(operationName = "SubmitCase")
public SubmitCaseResponse submitCase(SubmitCaseRequest request) { ... }
```

Lalu mapping eksplisit:

```java
CaseCommand command = mapper.toCommand(request);
CaseResult result = applicationService.submit(command);
return mapper.toResponse(result);
```

### 7.3 Operation harus punya semantic boundary jelas

SOAP operation bukan CRUD method default.

Buruk:

```text
create()
update()
delete()
process()
```

Lebih baik:

```text
SubmitCase
AcknowledgeCase
RequestCaseSupplement
CancelApplication
GetCaseStatus
```

Nama operation harus mencerminkan business action dan idempotency expectation.

---

## 8. WSDL Publishing: Generated vs Static WSDL

### 8.1 Generated WSDL

Banyak runtime dapat menghasilkan WSDL dari annotation.

Kelebihan:

- cepat,
- cocok untuk prototype,
- tidak perlu maintain WSDL manual,
- bagus untuk internal endpoint yang lifecycle-nya dikontrol.

Kekurangan:

- output bisa berubah saat upgrade runtime,
- namespace default bisa berubah karena refactor,
- schema style bisa kurang ideal,
- sulit menjamin compatibility,
- generated WSDL sering menjadi kontrak secara tidak sengaja.

### 8.2 Static WSDL

Dengan `wsdlLocation`, endpoint dapat dikaitkan dengan WSDL statis.

```java
@WebService(
    serviceName = "CaseExchangeService",
    portName = "CaseExchangePort",
    targetNamespace = "urn:gov:case-exchange:v1",
    endpointInterface = "com.acme.caseexchange.soap.CaseExchangePort",
    wsdlLocation = "WEB-INF/wsdl/CaseExchangeService.wsdl"
)
public class CaseExchangeEndpoint implements CaseExchangePort {
}
```

Kelebihan:

- kontrak stabil,
- bisa direview/diff,
- cocok untuk external consumer,
- mendukung governance,
- mengurangi runtime-specific drift.

Kekurangan:

- perlu disiplin sinkronisasi code-contract,
- perlu build/test yang validasi WSDL,
- generated Java harus diperlakukan hati-hati.

### 8.3 Praktik top-tier

Untuk endpoint production external:

```text
1. Simpan WSDL/XSD di repository.
2. Version artifact kontrak.
3. Jalankan validation/diff di CI.
4. Jangan publish perubahan WSDL tanpa review compatibility.
5. Gunakan static WSDL jika kontrak sudah dikonsumsi pihak luar.
```

---

## 9. Deployment Model

### 9.1 Container-managed endpoint

Dalam application server/Jakarta EE server, endpoint biasanya di-deploy sebagai bagian dari WAR/EAR.

```text
WAR/EAR
  ├─ endpoint class
  ├─ JAXB classes
  ├─ WSDL/XSD resources
  ├─ handler-chain.xml
  └─ container web service runtime
```

Container menyediakan:

- endpoint discovery,
- servlet mapping,
- WSDL publication,
- dependency injection integration,
- security integration,
- transaction integration,
- handler execution,
- monitoring/logging vendor-specific.

Contoh server/runtime:

- GlassFish / Payara,
- WildFly / JBoss EAP with JBossWS,
- WebLogic,
- WebSphere / Liberty,
- Metro on servlet container,
- Apache CXF stack.

### 9.2 Standalone `Endpoint.publish`

JAX-WS juga punya model publishing programmatic:

Javax:

```java
import javax.xml.ws.Endpoint;

public class SoapServer {
    public static void main(String[] args) {
        Endpoint.publish(
            "http://localhost:8080/case-exchange",
            new CaseExchangeEndpoint()
        );
    }
}
```

Jakarta:

```java
import jakarta.xml.ws.Endpoint;

public class SoapServer {
    public static void main(String[] args) {
        Endpoint.publish(
            "http://localhost:8080/case-exchange",
            new CaseExchangeEndpoint()
        );
    }
}
```

Cocok untuk:

- local testing,
- learning,
- test harness,
- mock SOAP provider,
- lightweight integration simulator.

Kurang ideal untuk enterprise production jika butuh:

- proper lifecycle,
- centralized security,
- thread pool/container tuning,
- observability,
- deployment governance,
- transaction/security integration.

### 9.3 Servlet container with Metro/CXF

Jika menjalankan SOAP di Tomcat/Jetty, biasanya runtime seperti Metro/CXF menyediakan servlet yang mem-publish endpoint.

Konsepnya:

```text
HTTP request
  ↓
JAX-WS servlet/listener
  ↓
runtime endpoint registry
  ↓
endpoint implementation
```

Ini memberi fleksibilitas, tetapi engineer harus mengelola dependency dan konfigurasi runtime sendiri.

---

## 10. Handler Chain: Cross-Cutting Concern pada SOAP Message

### 10.1 Apa itu handler?

Handler adalah interception point untuk SOAP message inbound/outbound.

Ada dua jenis umum:

| Jenis | Level |
|---|---|
| Logical handler | payload/message abstraction level |
| SOAP handler | SOAP envelope/header/body level |

SOAP handler dapat membaca/manipulasi SOAP header.

### 10.2 Contoh handler chain XML

`handler-chain.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<handler-chains xmlns="https://jakarta.ee/xml/ns/jakartaee"
                xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/jakartaee_web_services_metadata_handler_3_0.xsd"
                version="3.0">
    <handler-chain>
        <handler>
            <handler-name>CorrelationIdHandler</handler-name>
            <handler-class>com.acme.soap.CorrelationIdHandler</handler-class>
        </handler>
        <handler>
            <handler-name>SoapAuditHandler</handler-name>
            <handler-class>com.acme.soap.SoapAuditHandler</handler-class>
        </handler>
    </handler-chain>
</handler-chains>
```

Legacy Java EE `javax` deployments may use older namespace/schema variants. Always match runtime/spec version.

### 10.3 SOAP handler example

Jakarta version:

```java
package com.acme.soap;

import jakarta.xml.namespace.QName;
import jakarta.xml.soap.SOAPHeader;
import jakarta.xml.soap.SOAPMessage;
import jakarta.xml.ws.handler.MessageContext;
import jakarta.xml.ws.handler.soap.SOAPHandler;
import jakarta.xml.ws.handler.soap.SOAPMessageContext;

import java.util.Collections;
import java.util.Set;

public class CorrelationIdHandler implements SOAPHandler<SOAPMessageContext> {

    private static final String CORRELATION_ID_KEY = "correlationId";

    @Override
    public boolean handleMessage(SOAPMessageContext context) {
        Boolean outbound = (Boolean) context.get(MessageContext.MESSAGE_OUTBOUND_PROPERTY);

        if (Boolean.TRUE.equals(outbound)) {
            addCorrelationIdToResponse(context);
        } else {
            extractCorrelationIdFromRequest(context);
        }

        return true;
    }

    private void extractCorrelationIdFromRequest(SOAPMessageContext context) {
        try {
            SOAPMessage message = context.getMessage();
            SOAPHeader header = message.getSOAPHeader();

            String correlationId = null;
            if (header != null) {
                // Real code should read known QName from header.
                correlationId = findCorrelationId(header);
            }

            if (correlationId == null || correlationId.isBlank()) {
                correlationId = java.util.UUID.randomUUID().toString();
            }

            context.put(CORRELATION_ID_KEY, correlationId);
            context.setScope(CORRELATION_ID_KEY, MessageContext.Scope.APPLICATION);
        } catch (Exception e) {
            throw new RuntimeException("Failed to process SOAP correlation header", e);
        }
    }

    private void addCorrelationIdToResponse(SOAPMessageContext context) {
        // Add outbound header if required by contract.
    }

    private String findCorrelationId(SOAPHeader header) {
        // Placeholder: parse child element by QName.
        return null;
    }

    @Override
    public boolean handleFault(SOAPMessageContext context) {
        return true;
    }

    @Override
    public void close(MessageContext context) {
    }

    @Override
    public Set<QName> getHeaders() {
        return Collections.emptySet();
    }
}
```

### 10.4 Handler anti-patterns

Hindari:

- menjalankan business logic di handler,
- melakukan database transaction besar di handler,
- logging full SOAP body berisi PII/secret,
- mengubah body tanpa kontrak jelas,
- swallowing exception dan lanjut seolah request valid,
- membuat handler bergantung pada thread-local yang tidak jelas lifecycle-nya,
- parsing XML ulang besar-besaran di handler.

Handler idealnya untuk protocol concern, bukan domain concern.

---

## 11. SOAP Header Design

SOAP header sering dipakai untuk metadata lintas operasi.

Contoh metadata:

- correlation ID,
- request ID,
- tenant/agency ID,
- caller system ID,
- timestamp,
- signature/security token,
- locale,
- routing hint,
- idempotency key.

### 11.1 Jangan campur business payload ke header

Header adalah message metadata. Body adalah business document.

Buruk:

```text
Header: applicantName, applicationAmount, approvalStatus
Body: empty-ish payload
```

Lebih baik:

```text
Header: callerSystemId, correlationId, timestamp, signature
Body: SubmitApplicationRequest
```

### 11.2 Header harus punya namespace stabil

```xml
<soap:Header>
  <ctx:RequestContext xmlns:ctx="urn:gov:common:context:v1">
    <ctx:CorrelationId>...</ctx:CorrelationId>
    <ctx:CallerSystemId>...</ctx:CallerSystemId>
  </ctx:RequestContext>
</soap:Header>
```

Jangan pakai element tanpa namespace untuk header enterprise.

### 11.3 Required vs optional header

SOAP header punya konsep `mustUnderstand`. Jika dipakai, receiver yang tidak memahami header wajib fault.

Gunakan `mustUnderstand` untuk hal seperti security/routing yang benar-benar wajib. Jangan pakai untuk metadata opsional.

---

## 12. Fault Mapping Server Side

### 12.1 SOAP Fault bukan stack trace

SOAP Fault adalah kontrak error.

JAX-WS biasanya membedakan:

| Jenis | Makna |
|---|---|
| Modeled fault | exception yang dideklarasikan di WSDL/SEI |
| Unmodeled fault | runtime/unexpected exception |

Modeled fault harus dipakai untuk error business/protocol yang memang bagian dari kontrak.

### 12.2 Contoh fault bean

```java
package com.acme.caseexchange.soap.fault;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlType;

@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "CaseExchangeFaultDetail",
    propOrder = {"code", "message", "correlationId"},
    namespace = "urn:gov:case-exchange:fault:v1"
)
public class CaseExchangeFaultDetail {

    @XmlElement(name = "Code", required = true)
    private String code;

    @XmlElement(name = "Message", required = true)
    private String message;

    @XmlElement(name = "CorrelationId")
    private String correlationId;

    public CaseExchangeFaultDetail() {
    }

    public CaseExchangeFaultDetail(String code, String message, String correlationId) {
        this.code = code;
        this.message = message;
        this.correlationId = correlationId;
    }

    public String getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public String getCorrelationId() {
        return correlationId;
    }
}
```

### 12.3 Contoh modeled exception

```java
package com.acme.caseexchange.soap.fault;

import jakarta.xml.ws.WebFault;

@WebFault(
    name = "CaseExchangeFault",
    targetNamespace = "urn:gov:case-exchange:fault:v1"
)
public class CaseExchangeFault extends Exception {

    private final CaseExchangeFaultDetail faultInfo;

    public CaseExchangeFault(String message, CaseExchangeFaultDetail faultInfo) {
        super(message);
        this.faultInfo = faultInfo;
    }

    public CaseExchangeFault(String message, CaseExchangeFaultDetail faultInfo, Throwable cause) {
        super(message, cause);
        this.faultInfo = faultInfo;
    }

    public CaseExchangeFaultDetail getFaultInfo() {
        return faultInfo;
    }
}
```

SEI:

```java
@WebMethod(operationName = "SubmitCase")
SubmitCaseResponse submitCase(
    @WebParam(name = "SubmitCaseRequest") SubmitCaseRequest request
) throws CaseExchangeFault;
```

### 12.4 Error taxonomy

Design fault code dengan taxonomy stabil:

| Category | Contoh code | Retry? |
|---|---|---|
| validation | `VALIDATION_ERROR` | No, kecuali payload diperbaiki |
| authentication | `AUTHENTICATION_FAILED` | No/depends token refresh |
| authorization | `NOT_AUTHORIZED` | No |
| duplicate | `DUPLICATE_REQUEST` | Usually no, but return existing status possible |
| downstream unavailable | `DOWNSTREAM_UNAVAILABLE` | Yes with backoff if idempotent |
| timeout | `PROCESSING_TIMEOUT` | Depends idempotency |
| internal | `INTERNAL_ERROR` | Maybe, but hide detail |

Jangan expose:

- stack trace,
- SQL error detail,
- server path,
- secret/token,
- raw exception class internal,
- internal table/module name jika sensitif.

---

## 13. Validation Boundary

Ada beberapa lapis validasi:

```text
XML well-formedness
  ↓
SOAP envelope validity
  ↓
XSD/schema validity
  ↓
JAXB binding validity
  ↓
protocol/header validity
  ↓
business validation
```

Jangan mengandalkan satu lapis saja.

### 13.1 XSD validation

XSD cocok untuk:

- required element,
- type format dasar,
- enumeration,
- length/pattern,
- cardinality,
- structure.

XSD tidak cukup untuk:

- cross-field validation kompleks,
- authorization,
- data existence,
- temporal business rules,
- state machine transition,
- duplicate/idempotency behavior.

### 13.2 Endpoint-level validation

Endpoint harus melakukan boundary validation sebelum memanggil domain service.

```java
public SubmitCaseResponse submitCase(SubmitCaseRequest request) throws CaseExchangeFault {
    String correlationId = RequestContext.currentCorrelationId();

    try {
        boundaryValidator.validate(request);
        CaseCommand command = mapper.toCommand(request);
        CaseResult result = applicationService.submit(command);
        return mapper.toResponse(result);
    } catch (BoundaryValidationException e) {
        throw faultFactory.validationFault(e, correlationId);
    } catch (DuplicateRequestException e) {
        throw faultFactory.duplicateFault(e, correlationId);
    } catch (Exception e) {
        throw faultFactory.internalFault(e, correlationId);
    }
}
```

Rule penting:

```text
Endpoint translates transport/protocol/domain exceptions into SOAP fault contract.
Domain service should not know SOAP fault types.
```

---

## 14. Threading and Endpoint Instance Model

JAX-WS runtime/container dapat melayani banyak request secara paralel. Jangan asumsikan endpoint hanya dipanggil satu thread.

Praktik aman:

- endpoint class stateless,
- jangan simpan request-specific state di field instance,
- gunakan dependency thread-safe,
- gunakan local variable untuk request data,
- hati-hati dengan JAXB marshaller/unmarshaller jika dibuat manual,
- jangan pakai mutable static state untuk context request.

Buruk:

```java
@WebService
public class BadEndpoint {
    private String currentCorrelationId;

    public Response submit(Request request) {
        currentCorrelationId = request.getCorrelationId();
        // Race condition antar request
        return process(request);
    }
}
```

Lebih baik:

```java
public Response submit(Request request) {
    String correlationId = request.getCorrelationId();
    return process(request, correlationId);
}
```

Jika menggunakan thread-local untuk logging MDC, pastikan clear di finally atau handler close.

---

## 15. Dependency Injection dan Container Integration

### 15.1 Container-managed injection

Di Jakarta EE server, endpoint dapat memakai injection, tergantung runtime:

```java
@WebService(...)
public class CaseExchangeEndpoint implements CaseExchangePort {

    @jakarta.inject.Inject
    CaseApplicationService applicationService;

    @Override
    public SubmitCaseResponse submitCase(SubmitCaseRequest request) throws CaseExchangeFault {
        return applicationService.submit(request);
    }
}
```

Namun portability injection pada endpoint SOAP perlu diuji di runtime target. Jangan asumsikan semua container memperlakukan endpoint persis seperti CDI bean biasa, terutama pada legacy runtime.

### 15.2 Spring Boot caveat

Spring Boot tidak menyediakan JAX-WS server seperti JAX-RS out-of-the-box. Jika ingin SOAP server di Spring ecosystem, yang lebih umum adalah:

- Spring Web Services contract-first SOAP,
- Apache CXF Spring Boot integration,
- Metro manually configured,
- legacy servlet registration.

Jangan campur mental model Spring MVC REST dengan JAX-WS.

### 15.3 Endpoint as adapter

Pola paling aman:

```text
Endpoint class
  → injected/application service facade
  → pure use case service
  → domain/infrastructure
```

Endpoint bertugas:

- translate request,
- validate boundary,
- handle protocol metadata,
- call use case,
- translate response/fault.

---

## 16. Security Boundary Server Side

Part 29 nanti akan membahas SOAP security lebih dalam. Di sini kita bahas server-side positioning.

### 16.1 Transport security vs message security

| Security | Melindungi | Kapan cukup/tidak cukup |
|---|---|---|
| TLS/mTLS | channel client-server | Cukup untuk banyak internal point-to-point integration |
| WS-Security signature/encryption | message-level | Diperlukan jika message melewati intermediary atau butuh non-repudiation |
| SOAP header token | application identity/context | Harus divalidasi eksplisit |

### 16.2 Jangan percaya header begitu saja

Jika request membawa:

```xml
<ctx:CallerSystemId>SystemA</ctx:CallerSystemId>
```

itu bukan bukti autentikasi kecuali dikaitkan dengan:

- mTLS client certificate,
- signed SOAP header,
- trusted API gateway assertion,
- token validation,
- allowlist source.

### 16.3 Authorization di SOAP operation

Setiap operation tetap butuh authorization:

```text
caller system X boleh SubmitCase?
caller system X boleh submit untuk agency Y?
caller system X boleh melihat case type Z?
```

Jangan hanya authorize endpoint URL. SOAP endpoint sering punya banyak operation di satu URL.

### 16.4 Logging security

SOAP logging sangat membantu, tapi berbahaya.

Mask:

- NRIC/NIK/passport,
- personal address,
- phone/email,
- token,
- password,
- signature material,
- binary attachment,
- bank/account/payment info.

Simpan:

- timestamp,
- operation,
- caller system,
- correlation ID,
- fault code,
- latency,
- payload hash/canonical digest bila perlu,
- redacted request/response sample jika policy mengizinkan.

---

## 17. Observability untuk SOAP Endpoint

SOAP endpoint perlu observability yang operation-aware.

Minimal metrics:

| Metric | Dimensi |
|---|---|
| request count | operation, caller, result |
| latency | operation, caller |
| fault count | operation, fault code |
| payload size | operation |
| downstream latency | downstream system |
| timeout count | downstream/operation |
| duplicate/idempotency count | operation |

Log minimal:

```text
timestamp
correlationId
operation
callerSystemId
soapAction if used
requestSize
responseSize
result=SUCCESS|FAULT
faultCode
latencyMs
remoteAddress/gateway identity
```

Trace:

```text
SOAP inbound span
  ↓
validation span
  ↓
application service span
  ↓
downstream DB/API span
  ↓
SOAP outbound span
```

Jangan hanya log endpoint URL, karena satu SOAP URL bisa membawa banyak operation.

---

## 18. Idempotency and Duplicate Handling

SOAP operation sering dipakai untuk command: submit, update, cancel, approve.

Pertanyaan wajib:

```text
Jika client retry karena timeout, apakah operasi akan dieksekusi dua kali?
```

### 18.1 Idempotency key

Gunakan request ID / transaction ID dari caller:

```xml
<ctx:RequestId>SYS-A-2026-000001</ctx:RequestId>
```

Atau di body:

```xml
<ext:ExternalTransactionId>...</ext:ExternalTransactionId>
```

Server menyimpan idempotency record:

```text
callerSystemId + requestId + operation
  → processing status
  → response/fault summary
  → createdAt
  → completedAt
```

### 18.2 Response strategy

Jika duplicate request datang:

| Previous status | Response |
|---|---|
| completed success | return equivalent success response |
| completed validation fault | return same modeled fault |
| processing | return `DUPLICATE_IN_PROGRESS` or pollable status |
| unknown/expired | depends contract |

Jangan diam-diam proses ulang command non-idempotent.

---

## 19. Timeout and Retry Boundary

SOAP server harus membedakan:

- client timeout,
- server processing timeout,
- downstream timeout,
- transport connection drop,
- duplicate retry.

### 19.1 Server-side timeout design

Endpoint should not call downstream indefinitely.

```text
client timeout: 30s
server business timeout: 25s
downstream timeout: 5s / 10s depending call
DB query timeout: bounded
```

Jika server timeout lebih panjang dari client timeout, server bisa terus memproses setelah client pergi. Ini bisa memunculkan duplicate saat client retry.

### 19.2 Retry inside endpoint

Retry hanya aman jika:

- downstream operation idempotent,
- fault transient,
- retry budget kecil,
- ada correlation/idempotency,
- timeout total masih masuk SLA,
- tidak memperburuk overload.

Jangan retry validation/auth/business faults.

---

## 20. SOAPAction and Operation Dispatch

SOAP 1.1 sering memakai HTTP header `SOAPAction`. SOAP 1.2 berbeda dalam model action media type/action parameter.

Runtime dapat melakukan dispatch berdasarkan:

- body QName,
- WSDL binding operation,
- SOAPAction,
- runtime metadata.

Failure umum:

```text
Client mengirim SOAPAction salah
Body element namespace salah
Operation wrapper name salah
SOAP version mismatch
```

Checklist saat dispatch gagal:

1. Cek SOAP envelope namespace.
2. Cek body first child QName.
3. Cek target namespace operation wrapper.
4. Cek SOAPAction value.
5. Cek WSDL binding yang dipakai client.
6. Cek generated client berasal dari WSDL versi benar.

---

## 21. Namespace Control

Namespace adalah sumber bug terbesar di SOAP.

### 21.1 Jangan bergantung pada default namespace dari package

Explicit lebih aman:

```java
@WebService(targetNamespace = "urn:gov:case-exchange:v1")
```

JAXB package-info:

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "urn:gov:case-exchange:types:v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED,
    xmlns = {
        @jakarta.xml.bind.annotation.XmlNs(
            prefix = "ce",
            namespaceURI = "urn:gov:case-exchange:types:v1"
        )
    }
)
package com.acme.caseexchange.soap.types;
```

### 21.2 Prefix tidak sama dengan namespace

Prefix boleh berubah, namespace URI yang menentukan identitas.

Dua XML ini bisa ekuivalen:

```xml
<ce:SubmitCaseRequest xmlns:ce="urn:gov:case-exchange:types:v1"/>
```

```xml
<x:SubmitCaseRequest xmlns:x="urn:gov:case-exchange:types:v1"/>
```

Jangan validasi prefix string jika yang benar adalah validasi namespace URI.

---

## 22. Java 8 → Java 11+ Migration Checklist untuk JAX-WS Server

### 22.1 Inventory

Cari dependency implicit:

```text
javax.xml.ws.*
javax.jws.*
javax.xml.soap.*
javax.xml.bind.*
com.sun.xml.ws.*
com.sun.xml.bind.*
```

Cari juga tools/build:

```text
wsgen
wsimport
xjc
schemagen
```

Di Java 11+, tool JDK lama tidak tersedia seperti di Java 8.

### 22.2 Pilih strategi

| Strategi | Cocok untuk |
|---|---|
| Tetap `javax` + RI/vendor dependency | Migrasi Java runtime dulu tanpa migrasi Jakarta namespace |
| Migrasi ke `jakarta` | Jika runtime/container sudah Jakarta compatible |
| Ganti ke CXF/Metro explicit | Jika butuh servlet container standalone |
| Strangler/facade | Jika ingin mempertahankan contract tapi modernisasi internal |

### 22.3 Jangan campur `javax` dan `jakarta`

Buruk:

```text
Endpoint pakai jakarta.jws.WebService
DTO pakai javax.xml.bind.annotation.XmlRootElement
Runtime pakai javax.xml.ws.Endpoint
```

Ini sering menghasilkan error class not found, annotation tidak dibaca, JAXB context gagal, atau endpoint tidak terpublish.

Rule:

```text
Satu endpoint stack harus konsisten: javax stack atau jakarta stack.
```

### 22.4 Dependency harus align

Contoh konseptual Jakarta stack:

```xml
<dependency>
    <groupId>jakarta.xml.ws</groupId>
    <artifactId>jakarta.xml.ws-api</artifactId>
    <version>4.0.2</version>
</dependency>

<dependency>
    <groupId>com.sun.xml.ws</groupId>
    <artifactId>jaxws-rt</artifactId>
    <version>4.0.3</version>
</dependency>
```

Versi real harus disesuaikan dengan runtime/container target. Jangan copy dependency tanpa cek compatibility matrix server.

---

## 23. Testing Strategy Server Side

### 23.1 Test levels

| Level | Tujuan |
|---|---|
| Unit test mapper | SOAP DTO ↔ command/result |
| Unit test validation | request boundary validation |
| Endpoint test | method-level fault/response mapping |
| Contract test | WSDL/XSD compatibility |
| Message test | real SOAP XML request/response |
| Interop test | generated client dari platform lain bila perlu |
| Security test | header/signature/auth failure |
| Performance test | large payload, concurrency, memory |

### 23.2 Golden SOAP messages

Simpan sample request/response/fault sebagai fixture:

```text
src/test/resources/soap/golden/
  submit-case-request.valid.xml
  submit-case-response.success.xml
  submit-case-fault.validation.xml
  submit-case-request.missing-required.xml
  submit-case-request.wrong-namespace.xml
```

Golden messages sangat berguna untuk mencegah perubahan kontrak tak sengaja.

### 23.3 WSDL diff gate

CI ideal:

```text
Generate/publish WSDL
  ↓
Normalize formatting
  ↓
Diff against approved WSDL
  ↓
Fail if breaking change not approved
```

Breaking changes:

- rename operation,
- rename namespace,
- remove element,
- change required optionality,
- change type incompatible,
- remove fault,
- change service/port used by client.

### 23.4 Negative test penting

Test tidak boleh hanya happy path.

Wajib test:

- missing required header,
- wrong namespace,
- wrong SOAP version,
- invalid enum,
- invalid date format,
- unknown operation,
- duplicate request ID,
- downstream timeout,
- runtime exception masked as internal fault,
- large payload within and above limit,
- XML security hardening if custom parser used.

---

## 24. Production Failure Modes

### 24.1 WSDL berubah karena refactor

Gejala:

- client generated ulang gagal,
- consumer lama error unknown element,
- WSDL diff menunjukkan namespace berubah.

Penyebab:

- package Java berubah,
- annotation tidak eksplisit,
- runtime upgrade,
- DTO rename,
- generated WSDL dipakai sebagai kontrak external.

Mitigasi:

- explicit namespace/name,
- static WSDL,
- WSDL diff CI,
- contract-first untuk external boundary.

### 24.2 `arg0` muncul di WSDL

Penyebab:

- parameter tidak diberi `@WebParam`,
- compiled tanpa parameter metadata,
- runtime default naming.

Mitigasi:

- selalu pakai `@WebParam`,
- gunakan request wrapper object,
- review WSDL output.

### 24.3 Namespace mismatch

Gejala:

```text
Cannot find dispatch method for {...}SubmitCase
unexpected element
```

Mitigasi:

- cek QName, bukan prefix,
- align XSD/JAXB package namespace,
- golden SOAP tests,
- validate client generated dari WSDL benar.

### 24.4 JAXB context failure

Penyebab:

- missing no-arg constructor,
- mixed javax/jakarta annotations,
- duplicate element names,
- unsupported type,
- package not included,
- classloader conflict.

Mitigasi:

- DTO khusus SOAP,
- generated classes jangan diedit manual,
- dependency alignment,
- endpoint startup smoke test.

### 24.5 Memory spike karena SOAP logging

Penyebab:

- full message copied ke string,
- attachment/base64 besar,
- DOM conversion di handler,
- logging sync blocking.

Mitigasi:

- limit log size,
- redact streaming/partial,
- log hash/metadata,
- disable full payload log default,
- sample logs only in controlled environment.

### 24.6 Client retry menyebabkan duplicate processing

Penyebab:

- server memproses lama,
- client timeout lalu retry,
- tidak ada idempotency key.

Mitigasi:

- request ID,
- idempotency store,
- bounded timeout,
- duplicate response contract.

---

## 25. Design Template: Production-Grade SOAP Endpoint

### 25.1 Package structure

```text
com.acme.caseexchange.soap
  ├─ CaseExchangePort.java              // SEI contract
  ├─ CaseExchangeEndpoint.java          // SOAP adapter
  ├─ dto/                               // SOAP request/response JAXB DTO
  ├─ fault/                             // modeled faults
  ├─ mapper/                            // DTO ↔ application command/result
  ├─ validation/                        // boundary validation
  ├─ handler/                           // SOAP handlers
  └─ context/                           // request context extraction

com.acme.caseexchange.application
  ├─ CaseApplicationService.java
  ├─ command/
  └─ result/
```

### 25.2 Endpoint skeleton

```java
@WebService(
    serviceName = "CaseExchangeService",
    portName = "CaseExchangePort",
    targetNamespace = "urn:gov:case-exchange:v1",
    endpointInterface = "com.acme.caseexchange.soap.CaseExchangePort",
    wsdlLocation = "WEB-INF/wsdl/CaseExchangeService.wsdl"
)
@HandlerChain(file = "handler-chain.xml")
public class CaseExchangeEndpoint implements CaseExchangePort {

    private final CaseApplicationService applicationService;
    private final CaseExchangeMapper mapper;
    private final CaseExchangeBoundaryValidator validator;
    private final CaseExchangeFaultFactory faultFactory;

    public CaseExchangeEndpoint() {
        this.applicationService = Dependencies.caseApplicationService();
        this.mapper = Dependencies.caseExchangeMapper();
        this.validator = Dependencies.caseExchangeBoundaryValidator();
        this.faultFactory = Dependencies.caseExchangeFaultFactory();
    }

    @Override
    public SubmitCaseResponse submitCase(SubmitCaseRequest request) throws CaseExchangeFault {
        RequestContext context = RequestContextHolder.current();

        try {
            validator.validateSubmitCase(request, context);

            SubmitCaseCommand command = mapper.toSubmitCaseCommand(request, context);
            SubmitCaseResult result = applicationService.submitCase(command);

            return mapper.toSubmitCaseResponse(result);
        } catch (BoundaryValidationException e) {
            throw faultFactory.validationFault(e, context);
        } catch (DuplicateRequestException e) {
            throw faultFactory.duplicateFault(e, context);
        } catch (DownstreamUnavailableException e) {
            throw faultFactory.downstreamUnavailableFault(e, context);
        } catch (Exception e) {
            throw faultFactory.internalFault(e, context);
        }
    }
}
```

### 25.3 SEI skeleton

```java
@WebService(
    name = "CaseExchangePortType",
    targetNamespace = "urn:gov:case-exchange:v1"
)
@SOAPBinding(
    style = SOAPBinding.Style.DOCUMENT,
    use = SOAPBinding.Use.LITERAL,
    parameterStyle = SOAPBinding.ParameterStyle.WRAPPED
)
public interface CaseExchangePort {

    @WebMethod(operationName = "SubmitCase")
    @WebResult(name = "SubmitCaseResponse")
    SubmitCaseResponse submitCase(
        @WebParam(name = "SubmitCaseRequest") SubmitCaseRequest request
    ) throws CaseExchangeFault;
}
```

### 25.4 DTO skeleton

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "SubmitCaseRequest",
    propOrder = {"externalRequestId", "caseType", "applicant", "documents"},
    namespace = "urn:gov:case-exchange:types:v1"
)
public class SubmitCaseRequest {

    @XmlElement(name = "ExternalRequestId", required = true)
    private String externalRequestId;

    @XmlElement(name = "CaseType", required = true)
    private String caseType;

    @XmlElement(name = "Applicant", required = true)
    private Applicant applicant;

    @XmlElementWrapper(name = "Documents")
    @XmlElement(name = "Document")
    private List<DocumentRef> documents = new ArrayList<>();

    public SubmitCaseRequest() {
    }

    // getters/setters
}
```

---

## 26. Server-Side Compatibility Rules

### 26.1 Usually compatible

- add optional element at end of sequence if consumers tolerate it,
- add new operation without changing existing ones,
- add optional SOAP header not marked `mustUnderstand`,
- extend enum only if consumers are designed to tolerate unknown values,
- add new fault only if clients can handle generic faults or contract versioning allows.

### 26.2 Usually breaking

- rename namespace,
- rename operation,
- rename request/response wrapper,
- change element requiredness optional → required,
- remove element,
- change type string → int,
- reorder sequence if strict schema clients depend on it,
- change SOAP version,
- change service/port QName,
- change fault detail structure.

### 26.3 Versioning strategy

Common patterns:

```text
urn:gov:case-exchange:v1
urn:gov:case-exchange:v2
```

or:

```text
/soap/case-exchange/v1
/soap/case-exchange/v2
```

For major breaking change, prefer new namespace/service/endpoint rather than mutating existing contract.

---

## 27. Top 1% Mental Model: SOAP Endpoint as Adapter + Contract Guardian

A weak engineer thinks:

```text
I annotate a class, and SOAP works.
```

A strong engineer thinks:

```text
I am operating a contract boundary.
The WSDL/XSD is a promise.
The endpoint is an adapter.
The handler chain is protocol middleware.
JAXB is structural mapping, not domain modeling.
Faults are part of the contract.
Every timeout, retry, namespace, and schema change has consumer impact.
```

A top-tier SOAP server design asks:

1. What is the canonical external contract?
2. Which fields are required by schema vs business rule?
3. What is the operation idempotency model?
4. What are the modeled faults?
5. Which headers are mandatory and how are they authenticated?
6. Is WSDL generated or frozen?
7. How do we prevent accidental contract drift?
8. How do we observe operation-level latency/faults?
9. How do we handle duplicate request after timeout?
10. How do we migrate Java 8→17/21/25 without mixing `javax` and `jakarta`?

---

## 28. Practical Checklist

### 28.1 Before implementing

- [ ] Decide contract-first or code-first.
- [ ] Decide `javax` or `jakarta` stack.
- [ ] Identify runtime/container support.
- [ ] Define namespace/versioning strategy.
- [ ] Define operation names and request/response wrappers.
- [ ] Define SOAP headers and requiredness.
- [ ] Define fault taxonomy.
- [ ] Define idempotency key and duplicate behavior.
- [ ] Define logging/redaction policy.
- [ ] Define WSDL/XSD artifact governance.

### 28.2 During implementation

- [ ] Use SEI for stable contract.
- [ ] Set explicit `targetNamespace`.
- [ ] Set explicit `serviceName`, `portName`, `name`.
- [ ] Use `@WebMethod(operationName=...)`.
- [ ] Use `@WebParam` and `@WebResult`.
- [ ] Prefer document/literal wrapped.
- [ ] Keep endpoint stateless and thin.
- [ ] Do not expose domain entities.
- [ ] Translate exceptions to modeled faults.
- [ ] Avoid business logic in handlers.
- [ ] Mask SOAP logs.

### 28.3 Before release

- [ ] Validate WSDL and XSD.
- [ ] Run golden SOAP message tests.
- [ ] Test wrong namespace.
- [ ] Test missing header.
- [ ] Test modeled fault.
- [ ] Test unexpected exception masking.
- [ ] Test duplicate request.
- [ ] Test timeout/downstream failure.
- [ ] Test large payload and memory.
- [ ] Diff WSDL against approved contract.
- [ ] Confirm Java/Jakarta dependency alignment.

### 28.4 During operation

- [ ] Track operation-level latency.
- [ ] Track fault code distribution.
- [ ] Track caller system distribution.
- [ ] Track duplicate request count.
- [ ] Track payload size anomalies.
- [ ] Track downstream dependency failures.
- [ ] Keep sample redacted SOAP messages for support.
- [ ] Monitor WSDL endpoint accessibility if consumers fetch dynamically.

---

## 29. Common Interview / Architecture Questions

### Q1: Kapan memakai code-first JAX-WS?

Code-first masuk akal untuk internal endpoint kecil, prototype, atau service sementara yang consumer-nya dikontrol satu tim. Untuk kontrak eksternal/lintas organisasi, contract-first lebih aman karena WSDL/XSD menjadi sumber kebenaran dan mencegah accidental drift akibat refactor Java.

### Q2: Kenapa `@WebParam` penting?

Karena tanpa nama eksplisit, runtime bisa menghasilkan nama parameter default seperti `arg0`. Itu membuat WSDL buruk dan bisa mengunci consumer ke kontrak yang tidak bermakna.

### Q3: Kenapa endpoint class harus stateless?

Karena endpoint dapat melayani banyak request paralel. Request-specific state di field instance dapat menyebabkan race condition dan data leak antar request.

### Q4: Apa beda modeled fault dan unmodeled fault?

Modeled fault adalah error yang dideklarasikan sebagai bagian kontrak WSDL/SEI. Unmodeled fault berasal dari exception tak terduga dan biasanya dikonversi menjadi generic SOAP server fault. Business/protocol error yang diharapkan sebaiknya modeled.

### Q5: Apa risiko migrasi Java 8 ke Java 11+?

JAXB/JAX-WS/SAAJ tidak lagi bundled di JDK. Aplikasi yang sebelumnya bergantung pada JDK implicit module akan gagal compile/runtime kecuali dependency/API/runtime ditambahkan eksplisit. Selain itu harus dipilih konsisten antara `javax` legacy stack dan `jakarta` stack.

### Q6: Kenapa SOAP service masih memakai WSDL statis?

Karena WSDL adalah kontrak eksternal. Generated WSDL dapat berubah karena refactor atau upgrade runtime. Static WSDL membuat kontrak bisa direview, di-version, dan dijaga compatibility-nya.

---

## 30. Ringkasan

Di Part 24 ini, kita belajar bahwa JAX-WS / Jakarta XML Web Services server-side bukan sekadar annotation untuk expose method Java. Ia adalah runtime contract boundary yang menghubungkan WSDL, XSD, JAXB, SOAP envelope, handler chain, servlet/container, security, fault mapping, dan observability.

Poin paling penting:

1. SOAP endpoint adalah adapter, bukan domain service.
2. Untuk external enterprise integration, WSDL/XSD harus diperlakukan sebagai kontrak stabil.
3. Gunakan SEI, explicit namespace, explicit operation/parameter/result names.
4. Prefer document/literal wrapped untuk interoperability.
5. Endpoint harus stateless, thin, dan melakukan translation boundary.
6. Fault adalah bagian kontrak, bukan stack trace.
7. Handler chain cocok untuk protocol concern, bukan business logic.
8. Java 11+ membutuhkan dependency/runtime eksplisit karena JAX-WS/JAXB/SAAJ tidak lagi bundled di JDK.
9. Jangan campur `javax` dan `jakarta` stack sembarangan.
10. Production SOAP membutuhkan WSDL diff, golden message tests, redacted observability, idempotency, dan timeout/retry design.

Part berikutnya akan membahas **JAX-WS Client Side**: generated client dari WSDL, `Service`, port proxy, `Dispatch`, timeout, handler, dynamic endpoint override, retry boundary, dan bagaimana client SOAP production seharusnya didesain.

---

## 31. Status Seri

Seri belum selesai.

- Part selesai: 0 sampai 24.
- Part saat ini: **Part 24 — JAX-WS / Jakarta XML Web Services Server Side**.
- Berikutnya: **Part 25 — JAX-WS Client Side**.
- Target akhir: Part 34.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-023.md">⬅️ Part 23 — WSDL Deep Dive: Contract, Types, Messages, Port Types, Bindings, Services, and Evolution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-025.md">Part 25 — JAX-WS / Jakarta XML Web Services Client Side ➡️</a>
</div>
