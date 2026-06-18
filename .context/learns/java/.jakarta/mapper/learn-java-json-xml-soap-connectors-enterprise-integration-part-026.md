# Part 26 — SOAP Faults, Errors & Resilience

> Series: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> File: `learn-java-json-xml-soap-connectors-enterprise-integration-part-026.md`  
> Scope: Java 8 hingga Java 25, Javax/Jakarta XML Web Services, SOAP 1.1/1.2, fault contract, client/server resilience  
> Prerequisite: Part 22–25, terutama SOAP mental model, WSDL, JAX-WS server side, dan JAX-WS client side.

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah melihat SOAP dari tiga sisi:

1. **SOAP sebagai message protocol**: `Envelope`, `Header`, `Body`, dan `Fault`.
2. **WSDL sebagai service contract**: operasi, input/output message, binding, endpoint.
3. **JAX-WS/Jakarta XML Web Services sebagai Java programming model**: server endpoint, generated client, handler, `BindingProvider`, dan `Dispatch`.

Bagian ini fokus pada satu hal yang sering menentukan apakah integrasi SOAP enterprise stabil atau rapuh:

> Bagaimana failure direpresentasikan, diklasifikasikan, ditransmisikan, diterjemahkan, di-retry, diobservasi, dan dipulihkan.

Banyak engineer menganggap SOAP fault seperti exception biasa. Itu salah secara operasional.

SOAP fault bukan hanya error object. SOAP fault adalah **distributed failure contract**.

Artinya:

- fault harus bisa dipahami oleh sistem lain;
- fault harus stabil lintas versi;
- fault harus cukup detail untuk diagnosis tetapi tidak bocor informasi sensitif;
- fault harus membedakan business rejection, validation failure, protocol failure, authentication/authorization failure, downstream failure, timeout, dan duplicate processing;
- fault harus menjadi input untuk retry/idempotency/alerting/SLA;
- fault harus bisa diuji sebagai bagian dari kontrak, bukan hanya diuji sebagai exception lokal.

Jika SOAP service mengembalikan `RuntimeException` mentah, stack trace, generic `Server Error`, atau fault detail yang berubah-ubah, client akan membuat asumsi sendiri. Di situlah integrasi legacy menjadi rapuh.

---

## 2. Mental Model: Failure di SOAP Bukan Satu Dimensi

Dalam aplikasi monolith, error sering terlihat seperti ini:

```text
method call -> exception
```

Dalam SOAP integration, failure sebenarnya punya banyak layer:

```text
Caller
  -> local client construction failure
  -> marshalling failure
  -> network/DNS/TLS/proxy failure
  -> HTTP transport failure
  -> SOAP envelope/protocol failure
  -> SOAP fault from remote service
  -> application/business rejection
  -> downstream dependency failure behind remote service
  -> response unmarshalling failure
  -> local post-processing failure
```

Semua failure itu tidak boleh diperlakukan sama.

Contoh:

| Failure | Apakah request sampai ke server? | Aman retry? | Biasanya exception Java |
|---|---:|---:|---|
| DNS gagal | Tidak | Ya, dengan backoff | `WebServiceException` / transport exception |
| TLS handshake gagal | Tidak/unknown | Biasanya tidak sampai config fixed | `WebServiceException` |
| Timeout saat connect | Tidak | Mungkin | `WebServiceException` |
| Timeout saat read | Unknown | Hanya jika idempotent/idempotency key ada | `WebServiceException` |
| SOAP `Client/Sender` validation fault | Ya | Tidak sebelum payload diperbaiki | checked fault / `SOAPFaultException` |
| SOAP `Server/Receiver` transient fault | Ya | Mungkin, bounded retry | checked fault / `SOAPFaultException` |
| Business rejection | Ya | Tidak, perlu human/business action | modeled checked fault |
| Duplicate submission | Ya | Tidak sebagai create baru; query/idempotent replay | modeled fault / success replay |
| Response malformed | Ya | Jangan blindly retry | unmarshalling/protocol exception |

Top engineer tidak bertanya “exception apa?”. Mereka bertanya:

1. Apakah remote side menerima request?
2. Apakah operation idempotent?
3. Apakah failure transient atau permanent?
4. Apakah state remote berubah?
5. Apakah caller punya correlation/idempotency key?
6. Apakah retry bisa menciptakan duplicate side effect?
7. Apakah fault termasuk kontrak bisnis atau bug/protocol issue?
8. Apakah alert perlu dibuat, atau cukup return ke user?

---

## 3. SOAP Fault Menurut SOAP 1.1

SOAP 1.1 mendefinisikan fault di dalam `Body` dengan struktur utama:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Client</faultcode>
      <faultstring>Invalid request</faultstring>
      <faultactor>https://example.com/service</faultactor>
      <detail>
        <err:ValidationFault xmlns:err="urn:example:error">
          <err:code>INVALID_IDENTIFIER</err:code>
          <err:message>Identifier format is invalid</err:message>
        </err:ValidationFault>
      </detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>
```

Komponen penting:

| Element | Makna |
|---|---|
| `faultcode` | Kode machine-readable level SOAP. Wajib ada di SOAP 1.1. |
| `faultstring` | Penjelasan human-readable. Wajib ada di SOAP 1.1. |
| `faultactor` | Node/actor yang menyebabkan fault. Opsional. |
| `detail` | Informasi application-specific. Penting untuk modeled business/application fault. |

SOAP 1.1 standard fault codes umum:

| Fault code | Arti praktis |
|---|---|
| `VersionMismatch` | Namespace/version SOAP envelope salah. |
| `MustUnderstand` | Header dengan `mustUnderstand` tidak dipahami/diproses. |
| `Client` | Request dari client invalid atau tidak dapat diproses karena isi request. |
| `Server` | Server gagal memproses request karena masalah internal/transient. |

Mental model:

```text
SOAP 1.1 faultcode = kategori protocol-level
SOAP 1.1 detail    = application/business/proprietary diagnostic detail
```

Jangan menaruh semua variasi error hanya di `faultstring`. `faultstring` terlalu lemah untuk automation.

---

## 4. SOAP Fault Menurut SOAP 1.2

SOAP 1.2 memperbaiki struktur fault menjadi lebih eksplisit:

```xml
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Body>
    <env:Fault>
      <env:Code>
        <env:Value>env:Sender</env:Value>
        <env:Subcode>
          <env:Value>err:InvalidIdentifier</env:Value>
        </env:Subcode>
      </env:Code>
      <env:Reason>
        <env:Text xml:lang="en">Invalid request identifier</env:Text>
      </env:Reason>
      <env:Node>https://example.com/gateway</env:Node>
      <env:Role>https://example.com/roles/validator</env:Role>
      <env:Detail>
        <err:ValidationFault xmlns:err="urn:example:error">
          <err:code>INVALID_IDENTIFIER</err:code>
          <err:field>applicationId</err:field>
        </err:ValidationFault>
      </env:Detail>
    </env:Fault>
  </env:Body>
</env:Envelope>
```

SOAP 1.2 concepts:

| Element | Makna |
|---|---|
| `Code/Value` | Fault category utama. |
| `Code/Subcode` | Klasifikasi lebih spesifik. Bisa nested. |
| `Reason/Text` | Human-readable explanation, bisa multi-language. |
| `Node` | SOAP node yang menghasilkan fault. |
| `Role` | Role node saat fault terjadi. |
| `Detail` | Application-specific detail. |

SOAP 1.2 mengganti istilah SOAP 1.1:

| SOAP 1.1 | SOAP 1.2 |
|---|---|
| `Client` | `Sender` |
| `Server` | `Receiver` |
| `faultstring` | `Reason` |
| `faultactor` | `Node`/`Role` |
| `detail` | `Detail` |

Implikasi arsitektural:

- `Sender` biasanya tidak diretry sebelum request diperbaiki.
- `Receiver` mungkin transient, tetapi tetap harus dievaluasi dengan idempotency.
- `Subcode` bisa dipakai untuk machine-readable application error, tetapi banyak integrasi Java lebih nyaman memakai typed fault detail dari WSDL.

---

## 5. Fault Bukan HTTP Status

SOAP sering berjalan di atas HTTP, tetapi SOAP fault tidak sama dengan HTTP error.

Ada beberapa pola di lapangan:

| HTTP status | SOAP body | Interpretasi |
|---:|---|---|
| 200 | normal SOAP response | Success. |
| 200 | SOAP Fault | Secara SOAP gagal, walau HTTP OK. Beberapa stack legacy begini. |
| 500 | SOAP Fault | Umum untuk SOAP 1.1 fault server-side. |
| 400 | SOAP Fault | Bisa untuk invalid request, tergantung stack/policy. |
| 401/403 | HTML/proxy error atau SOAP Fault | Auth layer bisa berada di HTTP/proxy, bukan SOAP. |
| 502/503/504 | non-SOAP gateway error | Transport/intermediary failure, bukan SOAP application fault. |

Kesalahan umum:

```text
if HTTP status == 200 then success
```

Untuk SOAP, success harus berarti:

```text
transport acceptable
+ SOAP envelope parsed
+ body bukan Fault
+ response matches expected operation/output contract
+ application-level result success
```

Dan failure harus dipisahkan:

```text
HTTP/gateway failure != SOAP Fault != business rejection
```

---

## 6. JAX-WS/Jakarta XML Web Services Exception Taxonomy

Di Java/Jakarta XML Web Services, failure bisa muncul sebagai beberapa bentuk.

### 6.1 Modeled fault

Modeled fault adalah fault yang dideklarasikan dalam WSDL dan dipetakan ke checked exception Java.

Contoh service endpoint interface:

```java
@WebService(targetNamespace = "urn:example:case")
public interface CaseSubmissionPort {

    SubmitCaseResponse submitCase(SubmitCaseRequest request)
            throws ValidationFault_Exception, DuplicateSubmissionFault_Exception;
}
```

Biasanya generated exception terlihat seperti:

```java
@WebFault(name = "ValidationFault", targetNamespace = "urn:example:error")
public class ValidationFault_Exception extends Exception {

    private final ValidationFault faultInfo;

    public ValidationFault_Exception(String message, ValidationFault faultInfo) {
        super(message);
        this.faultInfo = faultInfo;
    }

    public ValidationFault getFaultInfo() {
        return faultInfo;
    }
}
```

Kelebihan modeled fault:

- menjadi bagian dari kontrak WSDL;
- client generated code tahu exception spesifik;
- detail fault punya schema;
- lebih aman untuk business/validation errors;
- cocok untuk compatibility testing.

Kekurangan:

- terlalu banyak fault types bisa membuat WSDL bengkak;
- perubahan detail fault bisa breaking;
- jika semua error dimodelkan sebagai checked exception, client code bisa kompleks;
- beberapa platform non-Java mungkin mapping-nya berbeda.

### 6.2 Unmodeled SOAP fault

Unmodeled fault adalah SOAP fault yang tidak dideklarasikan sebagai WSDL fault operation.

Di client Java, ini sering muncul sebagai:

```java
catch (SOAPFaultException e) {
    SOAPFault fault = e.getFault();
    String faultCode = fault.getFaultCode();
    String faultString = fault.getFaultString();
}
```

`SOAPFaultException` merepresentasikan SOAP 1.1/1.2 fault dan membungkus `SOAPFault` dari SOAP with Attachments API.

Unmodeled fault cocok untuk:

- protocol fault;
- unexpected server failure;
- security/intermediary fault;
- compatibility bug;
- generic fallback.

Tetapi untuk business rejection yang diharapkan, unmodeled fault buruk karena client kehilangan typed contract.

### 6.3 Runtime web service failure

`WebServiceException` adalah base runtime exception untuk Jakarta XML Web Services API runtime exceptions.

Contoh penyebab:

- endpoint URL invalid;
- WSDL tidak bisa dimuat;
- connection timeout;
- TLS failure;
- marshalling/unmarshalling error;
- handler error;
- binding/provider failure.

Pola handling:

```java
try {
    SubmitCaseResponse response = port.submitCase(request);
    return SubmitResult.success(response);
} catch (ValidationFault_Exception e) {
    return SubmitResult.rejected(e.getFaultInfo());
} catch (DuplicateSubmissionFault_Exception e) {
    return SubmitResult.duplicate(e.getFaultInfo());
} catch (SOAPFaultException e) {
    return SubmitResult.remoteFault(toRemoteFault(e));
} catch (WebServiceException e) {
    return SubmitResult.transportOrRuntimeFailure(e);
}
```

Urutan catch penting: checked modeled faults dulu, lalu SOAP fault, lalu runtime failure.

---

## 7. Modeled Fault vs Unmodeled Fault

Decision matrix:

| Situation | Gunakan modeled fault? | Alasan |
|---|---:|---|
| Validation error yang expected | Ya | Client perlu field/code detail. |
| Business rule rejection | Ya | Bagian dari domain contract. |
| Duplicate submission | Ya | Caller perlu recovery path. |
| Not found domain object | Biasanya ya | Jika expected dalam business flow. |
| Unauthorized due to app-level role | Bisa ya/tidak | Tergantung apakah auth di SOAP atau HTTP/security layer. |
| Invalid SOAP envelope | Tidak | Protocol fault. |
| MustUnderstand failure | Tidak | SOAP protocol fault. |
| Unexpected NullPointerException | Tidak | Server bug, jangan expose detail. |
| Downstream timeout behind service | Bisa generic modeled fault | Jika service ingin expose retryable dependency failure secara stabil. |
| Maintenance window | Bisa generic service-unavailable fault | Bila consumer butuh distinguish from validation. |

Prinsip:

> Business failures that consumers are expected to handle should be modeled. Technical surprises should be sanitized and mapped to stable generic faults.

---

## 8. Mendesain Fault Detail Schema

Fault detail sebaiknya schema-first dan stabil.

Contoh XSD:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="urn:example:error"
           xmlns:err="urn:example:error"
           elementFormDefault="qualified">

  <xs:element name="ValidationFault" type="err:ValidationFaultType"/>

  <xs:complexType name="ValidationFaultType">
    <xs:sequence>
      <xs:element name="errorId" type="xs:string"/>
      <xs:element name="code" type="err:ErrorCodeType"/>
      <xs:element name="message" type="xs:string" minOccurs="0"/>
      <xs:element name="fieldErrors" type="err:FieldErrorsType" minOccurs="0"/>
      <xs:element name="timestamp" type="xs:dateTime" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>

  <xs:simpleType name="ErrorCodeType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="INVALID_IDENTIFIER"/>
      <xs:enumeration value="MISSING_REQUIRED_FIELD"/>
      <xs:enumeration value="INVALID_DATE_RANGE"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:complexType name="FieldErrorsType">
    <xs:sequence>
      <xs:element name="fieldError" type="err:FieldErrorType" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="FieldErrorType">
    <xs:sequence>
      <xs:element name="field" type="xs:string"/>
      <xs:element name="code" type="xs:string"/>
      <xs:element name="message" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
```

### 8.1 Field yang sebaiknya ada

| Field | Tujuan |
|---|---|
| `errorId` | Correlation/debug ID yang aman dibagikan ke consumer. |
| `code` | Stable machine-readable code. |
| `message` | Human-readable summary; jangan dijadikan machine logic. |
| `fieldErrors` | Detail validation; opsional. |
| `timestamp` | Waktu fault dibuat; hati-hati timezone. |
| `retryable` | Boleh dipakai, tetapi jangan hanya percaya boolean tanpa idempotency context. |
| `severity` | Kadang berguna untuk enterprise support. |
| `sourceSystem` | Berguna untuk integration hub, tetapi jangan bocorkan topology sensitif. |

### 8.2 Field yang jangan dikirim ke consumer

Jangan expose:

- stack trace;
- SQL query;
- table name internal;
- file path server;
- hostname internal;
- pod/container name;
- secret/token;
- raw downstream response yang berisi PII;
- implementation class name;
- “NullPointerException at CaseServiceImpl.java:123”.

Internal details masuk log server, bukan fault contract.

---

## 9. Error Code Design

Error code adalah API contract. Jangan asal string.

Buruk:

```text
ERR_001
ERROR
INVALID
FAILED
SYSTEM_ERROR
```

Lebih baik:

```text
VALIDATION.MISSING_REQUIRED_FIELD
VALIDATION.INVALID_IDENTIFIER_FORMAT
BUSINESS.CASE_ALREADY_CLOSED
BUSINESS.SUBMISSION_WINDOW_EXPIRED
DUPLICATE.IDEMPOTENCY_KEY_REPLAY
SECURITY.INSUFFICIENT_PRIVILEGE
DEPENDENCY.DOWNSTREAM_TIMEOUT
DEPENDENCY.DOWNSTREAM_UNAVAILABLE
PROTOCOL.UNSUPPORTED_VERSION
```

Prinsip error code:

1. **Stable**: jangan berubah karena refactor.
2. **Machine-readable**: client boleh branch berdasarkan code.
3. **Domain meaningful**: code menjelaskan kategori bisnis/teknis.
4. **Not too granular**: jangan satu code per line of code.
5. **Not too generic**: jangan semua jadi `SYSTEM_ERROR`.
6. **Version-aware**: penambahan code baru harus dianggap compatible hanya jika client punya fallback.

### 9.1 Error code taxonomy

```text
VALIDATION.*
BUSINESS.*
AUTHENTICATION.*
AUTHORIZATION.*
DUPLICATE.*
CONFLICT.*
DEPENDENCY.*
RATE_LIMIT.*
PROTOCOL.*
SYSTEM.*
```

Untuk SOAP legacy, taxonomy ini bisa ditempatkan di:

- typed fault detail field `code`;
- SOAP 1.2 `Subcode`;
- custom SOAP Header untuk correlation/context;
- documentation/WSDL annotations.

---

## 10. Server-Side Fault Mapping

### 10.1 Jangan biarkan exception internal bocor

Buruk:

```java
@WebMethod
public SubmitCaseResponse submitCase(SubmitCaseRequest request) {
    return service.submit(request); // RuntimeException bocor ke SOAP stack
}
```

Lebih baik:

```java
@WebMethod
public SubmitCaseResponse submitCase(SubmitCaseRequest request)
        throws ValidationFault_Exception, DuplicateSubmissionFault_Exception, ServiceUnavailableFault_Exception {

    String correlationId = Correlation.currentOrCreate();

    try {
        validate(request);
        return applicationService.submit(request, correlationId);

    } catch (DomainValidationException e) {
        throw toValidationFault(e, correlationId);

    } catch (DuplicateSubmissionException e) {
        throw toDuplicateFault(e, correlationId);

    } catch (DownstreamTimeoutException e) {
        throw toServiceUnavailableFault(e, correlationId);

    } catch (Exception e) {
        logUnexpected(correlationId, e);
        throw toGenericServerFault(correlationId);
    }
}
```

Boundary rule:

```text
Internal exception taxonomy != external fault taxonomy
```

Internal exceptions boleh banyak dan implementation-specific. External faults harus stabil.

### 10.2 Mapping layer eksplisit

Buat satu layer:

```java
public final class SoapFaultMapper {

    public ValidationFault_Exception validation(DomainValidationException e, String correlationId) {
        ValidationFault fault = new ValidationFault();
        fault.setErrorId(correlationId);
        fault.setCode("VALIDATION.INVALID_REQUEST");
        fault.setMessage("Request validation failed");
        fault.setFieldErrors(mapFieldErrors(e));
        return new ValidationFault_Exception("Request validation failed", fault);
    }

    public ServiceUnavailableFault_Exception downstreamTimeout(DownstreamTimeoutException e, String correlationId) {
        ServiceUnavailableFault fault = new ServiceUnavailableFault();
        fault.setErrorId(correlationId);
        fault.setCode("DEPENDENCY.DOWNSTREAM_TIMEOUT");
        fault.setMessage("A required downstream system did not respond in time");
        fault.setRetryAfterSeconds(30);
        return new ServiceUnavailableFault_Exception("Temporary service failure", fault);
    }
}
```

Keuntungan:

- endpoint code bersih;
- mapping testable;
- policy external error tersentralisasi;
- mudah audit apakah exception internal bocor;
- mudah enforce security redaction.

---

## 11. Client-Side Fault Handling

Client SOAP production tidak cukup seperti ini:

```java
port.submitCase(request);
```

Client harus punya classification layer:

```java
public SubmitOutcome submit(SubmitCaseRequest request) {
    String idempotencyKey = request.getRequestId();

    try {
        SubmitCaseResponse response = port.submitCase(request);
        return SubmitOutcome.success(response);

    } catch (ValidationFault_Exception e) {
        return SubmitOutcome.rejected("VALIDATION", e.getFaultInfo());

    } catch (DuplicateSubmissionFault_Exception e) {
        return SubmitOutcome.duplicate(e.getFaultInfo());

    } catch (ServiceUnavailableFault_Exception e) {
        return retryPolicyOrDefer(request, e.getFaultInfo(), idempotencyKey);

    } catch (SOAPFaultException e) {
        RemoteFault fault = SoapFaultReader.read(e);
        return classifyUnmodeledFault(fault, request);

    } catch (WebServiceException e) {
        return classifyRuntimeFailure(e, request);
    }
}
```

### 11.1 Jangan langsung retry semua exception

Buruk:

```java
for (int i = 0; i < 3; i++) {
    try {
        return port.submitCase(request);
    } catch (Exception e) {
        Thread.sleep(1000);
    }
}
```

Ini bisa membuat:

- duplicate submission;
- double payment;
- repeated case creation;
- lock contention;
- message storm;
- downstream overload;
- SLA makin buruk.

Retry harus didasarkan pada:

```text
operation semantics + failure classification + idempotency control + bounded backoff + observability
```

---

## 12. Retry Taxonomy

SOAP operation bisa dibagi:

| Operation kind | Contoh | Retry policy |
|---|---|---|
| Pure query | `getCaseStatus` | Retry relatif aman dengan timeout/backoff. |
| Idempotent update | `updateContactDetails` dengan version/idempotency key | Retry aman jika idempotency/version enforced. |
| Non-idempotent create | `submitCase`, `createPayment` | Jangan retry unless idempotency key + duplicate handling. |
| External side effect | `sendNotification`, `disbursePayment` | Harus sangat hati-hati; prefer async/outbox/idempotency. |
| Batch operation | `submitBatch` | Retry per item atau whole batch perlu contract jelas. |

### 12.1 Failure retryability matrix

| Failure | Retry? | Catatan |
|---|---:|---|
| Connect timeout | Ya, bounded | Request kemungkinan belum sampai. |
| DNS temporary failure | Ya | Dengan backoff dan circuit breaker. |
| TLS cert expired | Tidak | Config/security issue. |
| HTTP 503/504 gateway | Mungkin | Perlu idempotency. |
| Read timeout | Hati-hati | Request mungkin sudah diproses. |
| SOAP Sender/Client fault | Tidak | Payload salah. |
| SOAP Receiver/Server transient fault | Mungkin | Perlu idempotency/backoff. |
| Business rejection | Tidak | Perlu action bisnis. |
| Duplicate fault | Jangan create ulang | Query/reconcile. |
| Unmarshal response error | Hati-hati | Bisa contract drift; retry jarang membantu. |

### 12.2 Backoff dasar

```java
public final class RetryPolicy {
    private final int maxAttempts = 3;

    public Duration delay(int attempt) {
        long base = switch (attempt) {
            case 1 -> 200L;
            case 2 -> 750L;
            default -> 2000L;
        };
        long jitter = ThreadLocalRandom.current().nextLong(0, 150);
        return Duration.ofMillis(base + jitter);
    }
}
```

Jangan retry tanpa jitter pada traffic tinggi. Tanpa jitter, semua caller bangun bersamaan dan memperparah overload.

---

## 13. Idempotency di SOAP

Idempotency adalah kemampuan memanggil operation berkali-kali dengan effect akhir yang sama.

Dalam SOAP, idempotency bisa dibawa lewat:

1. field request body, misalnya `requestId`, `submissionReference`, `transactionId`;
2. SOAP Header, misalnya `IdempotencyKey`;
3. WS-Addressing `MessageID` pada integrasi tertentu;
4. business natural key, jika benar-benar unique dan stabil.

Contoh header:

```xml
<soapenv:Header>
  <ctx:RequestContext xmlns:ctx="urn:example:context">
    <ctx:CorrelationId>c2f3e6b2-...</ctx:CorrelationId>
    <ctx:IdempotencyKey>SUBMIT-CASE-2026-000123</ctx:IdempotencyKey>
  </ctx:RequestContext>
</soapenv:Header>
```

Server harus menyimpan idempotency record:

```text
idempotency_key
operation_name
request_hash
status: IN_PROGRESS | SUCCESS | FAILED_RETRYABLE | FAILED_FINAL
response_reference
created_at
updated_at
expires_at
```

### 13.1 Idempotency algorithm

```text
On request:
  1. Extract idempotency key.
  2. Compute stable request hash.
  3. Try insert idempotency record atomically.
  4. If inserted:
       process request
       store success/final outcome
       return response
  5. If duplicate key exists:
       compare request hash
       if hash differs -> fault: IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD
       if previous SUCCESS -> replay previous response or return duplicate-with-reference
       if IN_PROGRESS -> return retry-later fault
       if FAILED_RETRYABLE -> allow controlled retry/resume
       if FAILED_FINAL -> return same final fault
```

Tanpa request hash, idempotency key bisa disalahgunakan untuk payload berbeda.

### 13.2 Duplicate handling options

| Strategy | Behavior | Cocok untuk |
|---|---|---|
| Replay success response | Return response yang sama untuk duplicate | API yang ingin client retry transparan. |
| Return duplicate fault with reference | Fault berisi existing transaction/case id | Legacy API yang membedakan first submit vs duplicate. |
| Return current status | Duplicate diarahkan ke query status | Long-running process. |
| Reject all duplicate | Sederhana, tapi kurang user-friendly | Operation manual/rare. |

---

## 14. Timeout Bukan Sekadar Angka

SOAP client wajib punya timeout.

Tanpa timeout:

- thread pool habis;
- request menggantung;
- connection pool penuh;
- cascading failure;
- batch job stuck;
- user melihat loading tanpa akhir.

Namun timeout harus dipahami sebagai contract.

### 14.1 Jenis timeout

| Timeout | Arti |
|---|---|
| Connect timeout | Waktu maksimum membuka koneksi. |
| Read/request timeout | Waktu maksimum menunggu response setelah request dikirim. |
| Pool acquisition timeout | Waktu maksimum menunggu connection dari pool, jika stack punya pool. |
| Overall operation deadline | Budget total dari caller termasuk retry. |

### 14.2 Deadline lebih baik daripada timeout terpisah

Buruk:

```text
3 retry × 30s read timeout = worst case 90s+
```

Lebih baik:

```text
overall deadline = 10s
attempt 1 = 2s
attempt 2 = 3s
attempt 3 = remaining budget
```

Untuk synchronous SOAP call dari web request, retry panjang sering lebih buruk daripada fail fast + async reconciliation.

---

## 15. Circuit Breaker dan Bulkhead untuk SOAP Client

SOAP downstream sering legacy dan lambat. Jika client tidak dibatasi, satu downstream bisa menjatuhkan service caller.

### 15.1 Circuit breaker

Circuit breaker mencegah caller terus memanggil dependency yang sedang gagal.

State mental model:

```text
CLOSED      -> normal
OPEN        -> fail fast
HALF_OPEN   -> probe limited request
```

Gunakan circuit breaker untuk:

- repeated timeout;
- repeated 503/504;
- repeated `Receiver`/`Server` transient fault;
- connection refused;
- pool exhaustion.

Jangan open circuit karena:

- validation fault;
- business rejection;
- duplicate fault;
- authorization denial spesifik user.

### 15.2 Bulkhead

Bulkhead membatasi resource untuk call ke dependency tertentu.

Contoh:

```text
case-service threads: 100
  -> max 10 concurrent calls to legacy-soap-A
  -> max 20 concurrent calls to registry-soap-B
  -> max 5 concurrent calls to payment-soap-C
```

Tanpa bulkhead, satu SOAP service lambat bisa menghabiskan semua thread caller.

---

## 16. SOAP Fault dan Transaction Boundary

SOAP synchronous call sering melibatkan database transaction. Ini sumber bug besar.

Buruk:

```java
@Transactional
public void submit() {
    saveLocalDraft();
    remoteSoapPort.submitCase(...); // remote call inside DB transaction
    markSubmitted();
}
```

Risiko:

- DB transaction terbuka terlalu lama;
- lock tertahan saat remote service lambat;
- jika read timeout terjadi, remote mungkin sudah sukses tapi local rollback;
- retry menciptakan duplicate;
- distributed transaction tidak benar-benar tersedia;
- support/reconciliation sulit.

Lebih baik:

```text
1. Persist local intent with status PENDING_SUBMISSION.
2. Commit local transaction.
3. Worker sends SOAP request with idempotency key.
4. Persist result SUCCESS/FAILED/RETRY_WAITING.
5. Reconcile unknown outcomes using query/status operation.
```

Pattern ini mirip outbox/saga.

Untuk SOAP yang mendukung XA/WS-AtomicTransaction, tetap jangan otomatis menganggap itu solusi. Banyak integrasi modern menghindari distributed transaction karena coupling dan operational complexity tinggi.

---

## 17. Unknown Outcome Problem

Unknown outcome terjadi ketika caller tidak tahu apakah remote memproses request.

Contoh:

```text
Client sends submitCase
Server receives and creates case
Server response lost due to network timeout
Client sees read timeout
```

Jika client retry tanpa idempotency, bisa create duplicate.

Solusi:

1. Idempotency key.
2. Client-generated business reference.
3. Query-by-reference operation.
4. Reconciliation job.
5. Audit trail cross-system.
6. Duplicate fault with existing reference.

Flow yang defensible:

```text
submitCase(requestId=ABC)
  -> timeout
getSubmissionStatus(requestId=ABC)
  -> FOUND SUCCESS caseId=123
local mark SUCCESS
```

Jika status not found:

```text
getSubmissionStatus(requestId=ABC)
  -> NOT_FOUND
retry submitCase with same requestId=ABC
```

---

## 18. Long-Running SOAP Operations

Tidak semua SOAP operation cocok synchronous.

Jika operation:

- melakukan screening besar;
- generate document;
- call banyak downstream;
- menunggu approval;
- proses batch;
- bisa lebih dari beberapa detik;

maka synchronous SOAP response sebaiknya hanya menerima request dan memberi tracking reference.

Pattern:

```text
submitBatch
  -> returns accepted(referenceId)

getBatchStatus(referenceId)
  -> PENDING | PROCESSING | COMPLETED | FAILED | PARTIALLY_COMPLETED

getBatchResult(referenceId)
  -> result document/items
```

Fault di `submitBatch` hanya untuk failure sebelum acceptance:

- invalid request;
- unauthorized;
- duplicate incompatible request;
- service unavailable before accepted.

Setelah accepted, business failure masuk status/result, bukan SOAP fault dari initial submit.

---

## 19. Partial Failure dan Batch SOAP

Batch operation lebih rumit daripada single operation.

Contoh request:

```xml
<SubmitApplicationsRequest>
  <application>...</application>
  <application>...</application>
  <application>...</application>
</SubmitApplicationsRequest>
```

Pertanyaan kontrak:

1. Apakah batch atomic?
2. Jika item ke-2 gagal, item ke-1 rollback?
3. Apakah response bisa partial success?
4. Apakah SOAP fault berarti seluruh batch gagal?
5. Bagaimana retry item yang gagal?
6. Apakah item punya idempotency key masing-masing?

### 19.1 Atomic batch

```text
all succeed or all fail
```

Jika satu item invalid, return modeled validation fault untuk seluruh batch.

Cocok untuk:

- small tightly coupled transaction;
- all-or-nothing semantics jelas.

Risiko:

- satu item jelek menggagalkan semua;
- retry besar;
- lock lama.

### 19.2 Partial batch

Response berisi result per item:

```xml
<SubmitApplicationsResponse>
  <itemResult>
    <clientItemId>A1</clientItemId>
    <status>SUCCESS</status>
    <remoteId>R123</remoteId>
  </itemResult>
  <itemResult>
    <clientItemId>A2</clientItemId>
    <status>FAILED</status>
    <errorCode>VALIDATION.INVALID_DATE</errorCode>
  </itemResult>
</SubmitApplicationsResponse>
```

Dalam pattern ini SOAP fault hanya untuk kegagalan envelope/batch-level, bukan item-level business failure.

---

## 20. Correlation ID dan Observability

Setiap SOAP call production harus punya correlation ID.

Letakkan di:

1. SOAP Header;
2. HTTP header, jika stack/proxy memungkinkan;
3. log MDC;
4. fault detail `errorId`;
5. audit trail;
6. downstream call context.

Contoh SOAP header:

```xml
<soapenv:Header>
  <ctx:RequestContext xmlns:ctx="urn:example:context">
    <ctx:CorrelationId>7d469c6f-1df7-4c58-a56e-cc74d0b6e780</ctx:CorrelationId>
    <ctx:SourceSystem>CASE_PORTAL</ctx:SourceSystem>
    <ctx:RequestTimestamp>2026-06-17T10:15:30Z</ctx:RequestTimestamp>
  </ctx:RequestContext>
</soapenv:Header>
```

### 20.1 Logging fields

Minimum log field:

```text
correlationId
operationName
endpointName
remoteSystem
soapAction
requestId/idempotencyKey
attemptNumber
latencyMs
outcome: SUCCESS | MODELED_FAULT | SOAP_FAULT | TRANSPORT_FAILURE | TIMEOUT
faultCode
faultSubcode/errorCode
httpStatus
retryDecision
```

### 20.2 Jangan log full SOAP payload sembarangan

SOAP payload sering berisi:

- PII;
- financial data;
- auth token;
- document attachment metadata;
- government/regulatory case detail;
- internal reference.

Log payload hanya dengan:

- explicit redaction;
- sampling;
- lower environment safeguards;
- secure storage;
- retention policy;
- access control.

---

## 21. Handler Chain untuk Fault Observability

JAX-WS handler bisa memeriksa outbound/inbound SOAP message.

Contoh skeleton:

```java
public final class SoapLoggingHandler implements SOAPHandler<SOAPMessageContext> {

    @Override
    public boolean handleMessage(SOAPMessageContext context) {
        Boolean outbound = (Boolean) context.get(MessageContext.MESSAGE_OUTBOUND_PROPERTY);
        // log metadata only, avoid raw payload by default
        return true;
    }

    @Override
    public boolean handleFault(SOAPMessageContext context) {
        String correlationId = extractCorrelationId(context);
        String faultCode = extractFaultCodeSafely(context);
        log.warn("SOAP fault received correlationId={} faultCode={}", correlationId, faultCode);
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

Handler rule:

- Jangan melakukan business decision kompleks di handler.
- Handler cocok untuk cross-cutting metadata, correlation, logging, security envelope, metrics.
- Jangan consume stream/payload dengan cara yang membuat runtime tidak bisa membaca message lagi.
- Hati-hati performance saat memanggil `SOAPMessage.writeTo()` untuk payload besar/MTOM.

---

## 22. Fault Security

Fault adalah attack surface.

### 22.1 Information leakage

Buruk:

```xml
<faultstring>ORA-00942: table CASE_APPLICATIONS does not exist</faultstring>
```

Lebih baik:

```xml
<faultstring>Internal processing error</faultstring>
<detail>
  <err:SystemFault>
    <err:errorId>...</err:errorId>
    <err:code>SYSTEM.INTERNAL_ERROR</err:code>
  </err:SystemFault>
</detail>
```

Internal log:

```text
correlationId=... exception=ORA-00942 stacktrace=...
```

### 22.2 Fault amplification

Jangan biarkan invalid request menghasilkan fault besar.

Contoh risiko:

- ribuan field error dikembalikan;
- nested validation menghasilkan response sangat besar;
- raw invalid XML dipantulkan balik;
- attacker menggunakan service sebagai reflection amplifier.

Mitigasi:

- batasi jumlah field errors;
- truncate message;
- jangan echo raw payload;
- set max response/fault size;
- rate limit invalid callers.

### 22.3 Authentication/authorization fault

Jangan membedakan terlalu detail:

```text
USER_NOT_FOUND
PASSWORD_WRONG
ROLE_X_MISSING
```

Untuk security-sensitive operation, pakai generic:

```text
AUTHENTICATION.FAILED
AUTHORIZATION.DENIED
```

Detail internal tetap di audit/security log.

---

## 23. MustUnderstand dan Header Faults

SOAP header bisa membawa metadata penting:

- authentication token;
- transaction context;
- WS-Addressing;
- correlation;
- idempotency;
- routing;
- digital signature/security.

Jika header ditandai `mustUnderstand="1"` dan node tidak mengerti header itu, SOAP harus menghasilkan `MustUnderstand` fault.

Contoh:

```xml
<soapenv:Header>
  <sec:SecurityContext soapenv:mustUnderstand="1"
                       xmlns:sec="urn:example:security">
    ...
  </sec:SecurityContext>
</soapenv:Header>
```

Design implication:

- gunakan `mustUnderstand` hanya untuk header yang benar-benar wajib untuk semantic correctness/security;
- jangan tandai semua header sebagai mustUnderstand;
- dokumentasikan role/actor yang harus memproses header;
- test client lama ketika menambahkan mandatory header baru;
- penambahan mandatory header bisa breaking change.

---

## 24. Versioning Fault Contract

Fault contract juga perlu versioning.

Perubahan yang biasanya compatible:

- menambahkan optional element di akhir sequence jika schema mendukung;
- menambahkan error code baru jika client punya fallback;
- memperjelas human-readable message tanpa mengubah machine code;
- menambah SOAP 1.2 subcode optional.

Perubahan yang biasanya breaking:

- menghapus fault detail element;
- mengubah namespace fault;
- mengubah root element fault detail;
- mengubah type dari field;
- mengubah enum tanpa fallback;
- mengubah checked fault operation signature;
- mengubah `Client/Sender` menjadi `Server/Receiver` tanpa alasan;
- mengganti error code yang sudah dipakai client.

Rule:

```text
Fault detail schema is part of the contract, not documentation.
```

---

## 25. Testing SOAP Faults

SOAP fault harus dites seperti success response.

### 25.1 Contract tests

Test minimal:

- invalid request menghasilkan expected modeled validation fault;
- duplicate request menghasilkan duplicate fault/status sesuai kontrak;
- missing mandatory header menghasilkan `MustUnderstand`/security fault;
- downstream unavailable menghasilkan sanitized service fault;
- unexpected exception tidak bocor stack trace;
- SOAP 1.1/1.2 fault shape sesuai binding;
- generated client bisa unmarshal fault detail;
- non-Java client sample bisa parse fault.

### 25.2 Golden XML fault fixtures

Simpan contoh fault XML:

```text
src/test/resources/soap/faults/validation-fault.soap.xml
src/test/resources/soap/faults/duplicate-submission-fault.soap.xml
src/test/resources/soap/faults/service-unavailable-fault.soap.xml
src/test/resources/soap/faults/must-understand-fault.soap.xml
```

Gunakan untuk:

- regression test;
- consumer documentation;
- compatibility diff;
- support/troubleshooting.

### 25.3 Negative tests

Test payload yang buruk:

- invalid namespace;
- missing element;
- unexpected element;
- wrong date format;
- duplicate business reference;
- huge field values;
- external entity attempt;
- invalid SOAPAction;
- wrong SOAP version;
- header missing.

---

## 26. Server Fault Handling Blueprint

Blueprint production-grade:

```text
SOAP Endpoint
  -> extract/generate correlation ID
  -> authenticate/authorize
  -> validate SOAP/business input
  -> call application service
  -> map domain result to SOAP response
  -> map expected domain failures to modeled faults
  -> map transient dependency failures to stable service fault
  -> map unexpected failures to sanitized generic fault
  -> log with correlation ID
  -> publish metrics
```

Pseudo-code:

```java
public SubmitCaseResponse submitCase(SubmitCaseRequest request)
        throws ValidationFault_Exception,
               DuplicateSubmissionFault_Exception,
               ServiceUnavailableFault_Exception,
               SystemFault_Exception {

    SoapRequestContext ctx = requestContextExtractor.extract();

    try {
        authorization.check(ctx, "CASE_SUBMIT");
        requestValidator.validate(request);

        SubmitCaseResult result = service.submit(request, ctx.idempotencyKey(), ctx.correlationId());
        metrics.success("submitCase");
        return mapper.toResponse(result);

    } catch (ValidationException e) {
        metrics.modeledFault("submitCase", "VALIDATION");
        throw faults.validation(e, ctx);

    } catch (DuplicateException e) {
        metrics.modeledFault("submitCase", "DUPLICATE");
        throw faults.duplicate(e, ctx);

    } catch (AuthorizationException e) {
        metrics.modeledFault("submitCase", "AUTHORIZATION");
        throw faults.authorizationDenied(ctx);

    } catch (DependencyUnavailableException e) {
        metrics.modeledFault("submitCase", "DEPENDENCY");
        throw faults.serviceUnavailable(e, ctx);

    } catch (Exception e) {
        metrics.unexpectedFault("submitCase");
        log.error("Unexpected SOAP endpoint failure correlationId={}", ctx.correlationId(), e);
        throw faults.system(ctx);
    }
}
```

---

## 27. Client Resilience Blueprint

Blueprint client-side:

```text
Application use case
  -> build SOAP request with correlation/idempotency key
  -> call SOAP client adapter
      -> apply deadline/timeout
      -> classify modeled faults
      -> classify unmodeled SOAP faults
      -> classify transport/runtime failures
      -> apply retry only if safe
      -> emit metrics/logs
  -> return domain-level outcome
```

Client adapter should hide SOAP-specific exceptions from domain/application layer.

Bad:

```java
public void submit() throws SOAPFaultException, WebServiceException
```

Better:

```java
public SubmissionGatewayResult submit(SubmissionCommand command)
```

Where:

```java
sealed interface SubmissionGatewayResult permits
        SubmissionGatewayResult.Success,
        SubmissionGatewayResult.ValidationRejected,
        SubmissionGatewayResult.Duplicate,
        SubmissionGatewayResult.TemporaryFailure,
        SubmissionGatewayResult.PermanentRemoteFailure,
        SubmissionGatewayResult.UnknownOutcome {

    record Success(String remoteCaseId) implements SubmissionGatewayResult {}
    record ValidationRejected(String code, String message) implements SubmissionGatewayResult {}
    record Duplicate(String existingRemoteCaseId) implements SubmissionGatewayResult {}
    record TemporaryFailure(String code, Duration retryAfter) implements SubmissionGatewayResult {}
    record PermanentRemoteFailure(String code, String errorId) implements SubmissionGatewayResult {}
    record UnknownOutcome(String correlationId, String idempotencyKey) implements SubmissionGatewayResult {}
}
```

For Java 8, use normal interface/classes instead of sealed interface/records.

---

## 28. Mapping SOAP Fault to Domain Outcome

Do not let SOAP vocabulary leak everywhere.

Mapping example:

| SOAP/JAX-WS failure | Domain/application outcome |
|---|---|
| `ValidationFault_Exception` | `ValidationRejected` |
| `DuplicateSubmissionFault_Exception` | `Duplicate` |
| `ServiceUnavailableFault_Exception` with retry-after | `TemporaryFailure` |
| `SOAPFaultException` with `Sender`/`Client` | `PermanentRemoteFailure` |
| `SOAPFaultException` with `Receiver`/`Server` | `TemporaryFailure` or `UnknownOutcome` |
| Read timeout during non-idempotent submit | `UnknownOutcome` |
| Connect timeout before send | `TemporaryFailure` |
| Unmarshal failure | `PermanentRemoteFailure` / integration bug |

This keeps application logic clean.

---

## 29. Metrics for SOAP Resilience

Useful metrics:

```text
soap_client_requests_total{operation, remoteSystem, outcome}
soap_client_latency_ms{operation, remoteSystem, outcome}
soap_client_faults_total{operation, faultCode, faultType}
soap_client_retries_total{operation, reason}
soap_client_timeouts_total{operation, phase}
soap_client_unknown_outcomes_total{operation}
soap_server_faults_total{operation, faultType, errorCode}
soap_server_latency_ms{operation, outcome}
soap_idempotency_replays_total{operation}
soap_duplicate_rejections_total{operation}
```

Alert on:

- spike in `Receiver/Server` faults;
- spike in timeouts;
- unknown outcome count;
- duplicate rate anomaly;
- validation fault sudden increase after deployment;
- unmodeled fault increase;
- unmarshalling errors after WSDL/schema change.

Do not alert on every validation fault. Validation faults may be normal user/client behavior. Alert on rate anomaly.

---

## 30. Common Anti-Patterns

### 30.1 Treating SOAP client as local method

```java
port.submitCase(request); // no timeout, no retry policy, no classification
```

Reality: this is remote IO with uncertain outcome.

### 30.2 Catching `Exception` and retrying

Causes duplicate side effects.

### 30.3 One generic `SystemFault` for everything

Client cannot distinguish user-correctable, retryable, duplicate, and permanent errors.

### 30.4 Exposing internal exception in faultstring

Security and support nightmare.

### 30.5 Relying on `faultstring` for business logic

Human message can change. Use code/detail.

### 30.6 No idempotency key for create/payment/submission

Read timeout becomes impossible to reason about.

### 30.7 Remote call inside local DB transaction

Creates locks, unknown outcomes, inconsistent state.

### 30.8 Logging entire SOAP messages in production

PII/security risk and massive log cost.

### 30.9 Adding mandatory SOAP header without versioning

Breaks old clients with `MustUnderstand` or validation faults.

### 30.10 Not testing fault XML

Success path passes, failure path breaks integration during incident.

---

## 31. Java 8 to Java 25 Considerations

### 31.1 Namespace and dependency axis

| Era | Typical package | Note |
|---|---|---|
| Java 8 + Java EE/JAX-WS | `javax.xml.ws`, `javax.xml.soap`, `javax.jws` | Some APIs historically available with JDK/app server. |
| Java 11+ | same if using old Javax libs explicitly | JDK no longer bundles Java EE/CORBA modules removed by JEP 320. |
| Jakarta EE 9+ | `jakarta.xml.ws`, `jakarta.xml.soap`, `jakarta.jws` | Namespace changed from `javax` to `jakarta`. |

Avoid mixing `javax` and `jakarta` artifacts in the same SOAP stack unless you really understand the provider/classpath consequences.

### 31.2 Generated code compatibility

Generated clients/server stubs are tied to:

- WSDL/XSD version;
- JAXB/Jakarta XML Binding version;
- JAX-WS/Jakarta XML Web Services version;
- namespace: `javax` vs `jakarta`;
- build plugin/tool version;
- runtime provider.

When migrating:

```text
Regenerate stubs intentionally
+ compare generated model changes
+ run golden XML tests
+ run fault unmarshalling tests
+ test timeout/fault behavior
+ test with real/simulated legacy endpoint
```

---

## 32. Practical Checklist

### 32.1 Server checklist

- [ ] Every operation has documented success and failure outcomes.
- [ ] Expected business/validation failures are modeled faults.
- [ ] Unexpected exceptions are sanitized.
- [ ] Fault detail schema has stable `code` and `errorId`.
- [ ] No stack trace/SQL/internal hostname in fault.
- [ ] Correlation ID appears in SOAP header, log, and fault detail.
- [ ] Duplicate/idempotency behavior is defined for side-effect operations.
- [ ] Batch partial failure semantics are explicit.
- [ ] Fault XML examples are documented.
- [ ] Fault contract is tested in CI.

### 32.2 Client checklist

- [ ] Connection/read/overall deadline configured.
- [ ] Modeled faults are handled explicitly.
- [ ] `SOAPFaultException` is classified.
- [ ] `WebServiceException` is classified.
- [ ] Retry only happens for safe conditions.
- [ ] Non-idempotent operations use idempotency key.
- [ ] Unknown outcome path exists.
- [ ] Metrics separate success/modeled fault/unmodeled fault/timeout.
- [ ] Logs include correlation/idempotency key.
- [ ] SOAP exceptions do not leak into domain layer.

---

## 33. Mini Case Study: Case Submission SOAP Integration

Scenario:

```text
Portal submits regulatory case to legacy agency SOAP service.
Operation: submitCase
Side effect: creates remote case
Risk: duplicate case if retry after timeout
```

### 33.1 Bad design

```text
Portal -> submitCase -> timeout -> retry -> timeout -> retry -> duplicate remote cases
```

Fault contract:

```text
All failures = Server Error
No idempotency
No query by client reference
No correlation ID
```

Incident result:

- user submits once;
- three remote cases created;
- local system marks failed;
- support manually reconciles;
- audit trail unclear.

### 33.2 Better design

Request includes:

```text
clientSubmissionId = UUID/business reference
correlationId = UUID
```

Server behavior:

```text
If clientSubmissionId new:
  create case
  store mapping
  return caseId

If same clientSubmissionId and same hash:
  return previous caseId or duplicate fault with existing caseId

If same clientSubmissionId but different hash:
  return IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD
```

Client behavior:

```text
submitCase
  if success -> local SUCCESS
  if validation fault -> local REJECTED
  if duplicate with existingCaseId -> local SUCCESS_DUPLICATE_REPLAY
  if read timeout -> queryStatus(clientSubmissionId)
  if status found -> local SUCCESS
  if status not found -> retry same idempotency key within policy
  if still unknown -> local UNKNOWN_OUTCOME and reconciliation job
```

This is the difference between “call SOAP API” and “operate enterprise integration safely”.

---

## 34. Top 1% Takeaways

1. SOAP fault is not an exception; it is a distributed failure contract.
2. Fault handling must separate transport failure, protocol fault, modeled business fault, duplicate, timeout, and unknown outcome.
3. `faultstring` is for humans, not automation.
4. Stable machine-readable error code is mandatory for serious integration.
5. Side-effect SOAP operations need idempotency and reconciliation.
6. Read timeout is dangerous because the remote side may have completed the operation.
7. Retry without idempotency is a data corruption strategy disguised as resilience.
8. SOAP faults must be tested as contract artifacts, not left to runtime behavior.
9. Server-side fault mapping should sanitize internal exceptions and expose stable external fault taxonomy.
10. Client-side SOAP adapter should translate SOAP/JAX-WS exceptions into domain outcomes.
11. Observability must include correlation ID, operation, endpoint, latency, fault code, retry decision, and unknown outcome count.
12. Java 8→11+ and Javax→Jakarta migration can change exception/runtime behavior; test fault paths, not only success paths.

---

## 35. Ringkasan

Di Part 26 ini kita membahas SOAP failure dari sudut pandang production engineering.

Kita melihat bahwa SOAP fault punya struktur berbeda antara SOAP 1.1 dan SOAP 1.2, bahwa JAX-WS/Jakarta XML Web Services membedakan modeled fault, unmodeled SOAP fault, dan runtime `WebServiceException`, dan bahwa client/server harus memiliki mapping layer yang eksplisit.

Konsep paling penting adalah **unknown outcome**. Dalam distributed system, timeout tidak berarti gagal. Timeout berarti caller tidak tahu hasilnya. Karena itu side-effect operation seperti submit/create/payment harus punya idempotency key, duplicate handling, query/reconciliation path, dan bounded retry.

Dengan mental model ini, SOAP legacy tidak lagi dilihat sebagai teknologi tua yang “ribet”, tetapi sebagai kontrak enterprise yang harus dioperasikan dengan invariants, failure taxonomy, observability, dan compatibility discipline.

---

## 36. Referensi

- W3C — SOAP Version 1.2 Part 1: Messaging Framework.
- W3C — Simple Object Access Protocol (SOAP) 1.1.
- Jakarta XML Web Services 4.0 Specification and API Docs.
- Jakarta XML Web Services API — `jakarta.xml.ws.soap.SOAPFaultException`.
- Jakarta XML Web Services API — `jakarta.xml.ws.WebServiceException`.
- Jakarta SOAP with Attachments API.
- OpenJDK JEP 320 — Remove the Java EE and CORBA Modules.
- Eclipse Metro / Jakarta XML Web Services implementation documentation.

---

## 37. Status Series

Part ini adalah **Part 26 dari 34**.

Seri **belum selesai**.

Berikutnya: **Part 27 — SOAP Attachments & MTOM/SAAJ**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-025.md">⬅️ Part 25 — JAX-WS / Jakarta XML Web Services Client Side</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-027.md">Part 27 — SOAP Attachments & MTOM/SAAJ ➡️</a>
</div>
