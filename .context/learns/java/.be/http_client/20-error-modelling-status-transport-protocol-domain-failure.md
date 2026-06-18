# Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `20-error-modelling-status-transport-protocol-domain-failure.md`  
Target: Java 8 hingga Java 25  
Level: Advanced / production engineering

---

## 1. Tujuan Bagian Ini

Banyak HTTP client di production gagal bukan karena tidak bisa melakukan request, tetapi karena **tidak bisa memahami arti kegagalan**.

Kode seperti ini terlihat sederhana:

```java
Response response = client.execute(request);
if (response.statusCode() != 200) {
    throw new RuntimeException("API failed");
}
```

Tetapi dari sudut pandang engineering, kode tersebut kehilangan hampir semua informasi penting:

- apakah request tidak pernah sampai ke server?
- apakah server menerima request tetapi gagal memproses?
- apakah timeout terjadi sebelum atau sesudah side effect?
- apakah error bisa di-retry?
- apakah user boleh melihat pesan error ini?
- apakah error berasal dari transport, TLS, HTTP protocol, schema, atau business rule?
- apakah response body bisa dipercaya?
- apakah error perlu masuk audit trail?
- apakah error harus membuka circuit breaker?
- apakah error harus dihitung sebagai downstream failure?
- apakah error harus diubah menjadi domain decision seperti `PaymentRejected`, `AddressNotFound`, atau `EligibilityUnknown`?

Part ini membahas cara membangun **error model HTTP client** yang tajam, stabil, bisa diobservasi, dan aman dipakai dalam sistem besar.

Tujuannya bukan membuat hierarchy exception yang rumit. Tujuannya adalah membuat **classification system** yang membantu sistem mengambil keputusan yang benar.

---

## 2. Mental Model Utama: Error Bukan Satu Dimensi

Dalam HTTP client, “error” minimal punya beberapa dimensi:

```text
WHERE did it fail?
→ DNS, connect, TLS, write, wait response, read body, decode, domain validation

WHAT kind of failure?
→ transport, protocol, HTTP status, schema, semantic, policy, security

CAN we retry?
→ yes, no, maybe, only if idempotent, only after Retry-After

IS side effect possible?
→ impossible, unknown, likely, confirmed

WHO should see it?
→ user, operator, developer, audit, security team

WHAT should caller do?
→ retry, fallback, reject, escalate, compensate, ask user, open circuit
```

Top-tier HTTP client tidak hanya mengembalikan `Exception`. Ia mengembalikan **classified outcome**.

---

## 3. Outcome Model: Response Sukses Tidak Sama Dengan Domain Sukses

HTTP response bisa sukses secara transport tetapi gagal secara domain.

Contoh:

```text
HTTP 200 OK
{
  "success": false,
  "code": "INSUFFICIENT_BALANCE",
  "message": "Balance is insufficient"
}
```

Transport sukses:

```text
DNS ok
TCP ok
TLS ok
request sent
response received
JSON parsed
```

Tetapi domain gagal:

```text
operation rejected by downstream business rule
```

Sebaliknya, HTTP 404 bisa jadi domain outcome normal:

```text
GET /customer/{id}
404 Not Found
```

Dalam satu domain, ini bisa berarti:

```text
Customer does not exist
```

Bukan selalu exception teknis.

Karena itu, jangan samakan:

```text
HTTP 2xx = success
HTTP non-2xx = exception
```

Model yang lebih benar:

```text
HTTP exchange outcome
→ transport outcome
→ protocol outcome
→ representation outcome
→ semantic outcome
→ domain outcome
```

---

## 4. Taxonomy Besar Error HTTP Client

Kita akan pakai taxonomy berikut:

```text
1. Configuration error
2. Request construction error
3. DNS / name resolution failure
4. Connection failure
5. TLS / certificate failure
6. Timeout / cancellation
7. Write failure
8. Response header failure
9. Response body read failure
10. HTTP status error
11. Redirect / authentication / proxy policy failure
12. Decode / deserialization failure
13. Schema / compatibility failure
14. Semantic / domain failure
15. Client policy failure
16. Security classification failure
17. Unknown / unclassified failure
```

Mari bahas satu per satu.

---

## 5. Configuration Error

Configuration error terjadi sebelum request benar-benar dieksekusi.

Contoh:

```text
base URL kosong
invalid URI template
timeout negatif
missing client secret
truststore path salah
proxy config invalid
unsupported protocol
```

Karakteristik:

```text
usually deterministic
usually non-retryable
should fail fast
should be detected at startup if possible
```

Contoh exception domain:

```java
public final class ExternalClientConfigurationException extends RuntimeException {
    public ExternalClientConfigurationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Namun lebih baik configuration divalidasi saat aplikasi start:

```java
public record PaymentClientConfig(
        URI baseUri,
        Duration connectTimeout,
        Duration responseTimeout,
        int maxConcurrency
) {
    public PaymentClientConfig {
        if (baseUri == null) throw new IllegalArgumentException("baseUri is required");
        if (!"https".equalsIgnoreCase(baseUri.getScheme())) {
            throw new IllegalArgumentException("baseUri must use https");
        }
        if (connectTimeout == null || connectTimeout.isNegative() || connectTimeout.isZero()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (responseTimeout == null || responseTimeout.isNegative() || responseTimeout.isZero()) {
            throw new IllegalArgumentException("responseTimeout must be positive");
        }
        if (maxConcurrency <= 0) {
            throw new IllegalArgumentException("maxConcurrency must be positive");
        }
    }
}
```

Production rule:

> Configuration error harus gagal cepat, bukan muncul sebagai random runtime error saat traffic sudah masuk.

---

## 6. Request Construction Error

Request construction error terjadi ketika input aplikasi tidak bisa diubah menjadi HTTP request valid.

Contoh:

```text
invalid path parameter
malformed URI
unsupported character
invalid header value
body serialization gagal
missing required field
invalid date format
```

Bedakan dua kasus:

### 6.1 Bug Internal

Contoh:

```java
URI.create("https://api.example.com/customer/" + rawUserInput)
```

Jika `rawUserInput` berisi karakter berbahaya atau tidak ter-encode, ini bug client adapter.

### 6.2 Input Domain Tidak Valid

Contoh:

```text
postal code harus 6 digit
country code tidak dikenal
date range tidak valid
```

Ini bukan downstream failure. Ini validasi aplikasi.

Model yang baik:

```text
invalid domain input
→ reject before HTTP call

valid domain input but cannot construct HTTP due to programmer bug
→ internal client bug
```

Jangan retry request construction error.

---

## 7. DNS / Name Resolution Failure

DNS failure terjadi sebelum koneksi TCP dibuat.

Contoh gejala:

```text
UnknownHostException
Temporary failure in name resolution
NXDOMAIN
DNS timeout
CoreDNS issue
corporate DNS issue
split horizon DNS mismatch
```

Makna penting:

```text
server kemungkinan belum menerima request
side effect almost certainly did not happen
```

Tetapi hati-hati: jika failure terjadi pada retry attempt kedua setelah attempt pertama sukses mengirim request, side effect bisa sudah terjadi.

Classification:

```text
category: TRANSPORT
phase: DNS
retryable: maybe
sideEffect: no for this attempt
operatorAction: check DNS, network, service discovery
```

Java example:

```java
import java.net.UnknownHostException;

static boolean isDnsFailure(Throwable t) {
    while (t != null) {
        if (t instanceof UnknownHostException) return true;
        t = t.getCause();
    }
    return false;
}
```

Retry guidance:

```text
safe to retry only if operation-level deadline remains
use backoff
avoid tight retry loop
watch DNS outage blast radius
```

---

## 8. Connection Failure

Connection failure terjadi saat client gagal membuat koneksi TCP atau koneksi putus sebelum exchange selesai.

Contoh:

```text
ConnectException: Connection refused
NoRouteToHostException
SocketException: Connection reset
connection reset by peer
broken pipe
```

Penting membedakan fase:

```text
connect failure before write
→ server likely did not receive request

connection reset after request write
→ server may have received request

connection reset while reading response
→ side effect status unknown
```

Ini salah satu alasan mengapa retry POST tanpa idempotency key berbahaya.

Classification example:

```java
public enum FailurePhase {
    CONFIGURATION,
    REQUEST_BUILD,
    DNS,
    CONNECT,
    TLS,
    WRITE,
    WAIT_RESPONSE,
    READ_RESPONSE,
    DECODE,
    HTTP_STATUS,
    DOMAIN,
    POLICY,
    UNKNOWN
}
```

```java
public enum SideEffectRisk {
    NONE,
    UNKNOWN,
    POSSIBLE,
    CONFIRMED
}
```

Connection refused biasanya:

```text
phase: CONNECT
sideEffectRisk: NONE
```

Connection reset while reading response:

```text
phase: READ_RESPONSE
sideEffectRisk: UNKNOWN or POSSIBLE
```

---

## 9. TLS / Certificate Failure

TLS failure terjadi setelah TCP connect tetapi sebelum secure HTTP exchange berhasil.

Contoh:

```text
SSLHandshakeException
PKIX path building failed
certificate expired
hostname mismatch
no subject alternative name
unsupported protocol
bad_certificate dalam mTLS
ALPN negotiation issue
```

Makna:

```text
request application data biasanya belum dikirim
server identity/trust gagal diverifikasi
retry biasanya tidak membantu kecuali transient TLS termination issue
```

Classification:

```text
category: SECURITY / TRANSPORT
phase: TLS
retryable: usually no
sideEffectRisk: none
userMessage: service connection could not be secured
operatorAction: certificate/truststore/keystore/hostname investigation
```

Anti-pattern paling berbahaya:

```java
// Jangan lakukan ini di production.
TrustManager[] trustAll = new TrustManager[] { /* trust all certs */ };
```

TLS error sebaiknya tidak disamarkan menjadi generic timeout. Ia perlu terlihat sebagai trust/security failure.

---

## 10. Timeout dan Cancellation

Timeout bukan satu jenis error. Timeout harus diklasifikasi berdasarkan fase:

```text
DNS timeout
connect timeout
TLS handshake timeout
pool acquisition timeout
write timeout
response header timeout
read body timeout
operation deadline timeout
```

Makna side effect berbeda.

### 10.1 Connect Timeout

```text
client gagal connect
server likely did not receive request
retry may be safe if deadline remains
```

### 10.2 Write Timeout

```text
client gagal mengirim full request body
server may receive partial body
side effect usually unlikely but not always impossible
```

### 10.3 Response Timeout

```text
request may have been fully processed
server may have committed side effect
client does not know result
```

### 10.4 Read Body Timeout

```text
headers received
body incomplete
server likely handled request
result may be unusable
```

### 10.5 Caller Cancellation

Cancellation bisa berasal dari:

```text
user cancelled
HTTP request deadline expired
parent operation cancelled
server shutdown
thread interrupted
reactive subscription cancelled
structured concurrency scope cancelled
```

Cancellation bukan selalu downstream failure.

Production rule:

> Timeout setelah request terkirim harus dianggap outcome unknown untuk operasi yang punya side effect.

Contoh typed classification:

```java
public record HttpClientFailure(
        FailurePhase phase,
        FailureKind kind,
        RetryDecision retryDecision,
        SideEffectRisk sideEffectRisk,
        int attempt,
        Throwable cause,
        String safeMessage
) {}
```

```java
public enum FailureKind {
    CONFIGURATION,
    INVALID_REQUEST,
    DNS,
    CONNECTION,
    TLS,
    TIMEOUT,
    CANCELLED,
    HTTP_STATUS,
    DECODE,
    SCHEMA,
    DOMAIN,
    POLICY,
    SECURITY,
    UNKNOWN
}
```

---

## 11. Write Failure

Write failure terjadi saat client mengirim header/body ke socket.

Contoh:

```text
broken pipe
connection reset while writing
write timeout
request body stream failed
file read error during upload
```

Pertanyaan penting:

```text
apakah server menerima sebagian request?
apakah body repeatable?
apakah operation idempotent?
apakah ada idempotency key?
```

Jika request body adalah streaming upload besar, retry bisa bermasalah:

```text
body mungkin tidak bisa dibaca ulang
server mungkin menerima partial upload
retry bisa membuat duplikasi object/file
```

Karena itu body model perlu punya metadata:

```java
public enum BodyRepeatability {
    REPEATABLE,
    NON_REPEATABLE,
    UNKNOWN
}
```

Retry rule:

```text
retry write failure only if:
- operation is idempotent, or
- idempotency key is present and downstream guarantees deduplication, and
- request body is repeatable, and
- operation deadline still has budget
```

---

## 12. Response Header Failure

Response header failure terjadi saat client menunggu atau membaca status line/header.

Contoh:

```text
server closed connection before response
invalid status line
malformed header
header too large
response header timeout
```

Makna:

```text
request may have reached server
server may have completed side effect
client does not have outcome
```

Classification:

```text
phase: WAIT_RESPONSE
kind: PROTOCOL or TIMEOUT
sideEffectRisk: UNKNOWN/POSSIBLE
retryable: depends on idempotency
```

---

## 13. Response Body Read Failure

Response body read failure terjadi setelah status/header diterima.

Contoh:

```text
connection reset while reading body
read timeout
unexpected EOF
compressed stream corrupted
decompression failure
body too large
```

HTTP status bisa 200, tetapi body tidak lengkap.

Contoh:

```text
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 1000000

{ partial json ... connection reset
```

Ini bukan success.

Classification:

```text
HTTP status observed: yes
body complete: no
representation usable: no
sideEffectRisk: operation-specific
```

Production consequence:

- jangan parse partial body sebagai default value
- jangan treat sebagai not found
- jangan retry non-idempotent operation tanpa deduplication
- log body length, expected length jika aman
- metric khusus `response_body_incomplete`

---

## 14. HTTP Status Error

HTTP status adalah response valid di level transport/protocol.

Contoh:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
412 Precondition Failed
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

Namun status code tidak boleh dimaknai terlalu generik. Status yang sama bisa punya arti domain berbeda.

---

## 15. Mapping 4xx: Client Error Tidak Selalu Bug Caller

### 15.1 400 Bad Request

Kemungkinan arti:

```text
client adapter bug
invalid domain input yang lolos validasi
contract drift
wrong serialization
wrong content-type
```

Retry:

```text
usually no
```

Action:

```text
fix caller or contract
```

### 15.2 401 Unauthorized

Kemungkinan arti:

```text
missing token
token expired
token invalid
clock skew
auth server issue
wrong audience/scope
```

Retry:

```text
maybe after token refresh
not infinite
single-flight refresh recommended
```

### 15.3 403 Forbidden

Kemungkinan arti:

```text
authenticated but not allowed
wrong scope
wrong tenant
policy deny
IP allowlist issue
```

Retry:

```text
usually no
```

### 15.4 404 Not Found

Kemungkinan arti:

```text
resource absent
wrong path
wrong environment
wrong tenant
stale reference
```

Domain-specific:

```text
GET customer by id → CustomerNotFound may be normal
POST command endpoint → wrong route may be client bug
```

### 15.5 409 Conflict

Kemungkinan arti:

```text
concurrent modification
business conflict
idempotency duplicate
duplicate reference
state machine conflict
```

Retry:

```text
maybe after reload/reconcile
not blind retry
```

### 15.6 412 Precondition Failed

Biasanya terkait conditional request:

```text
ETag mismatch
If-Match failed
optimistic locking conflict
```

Domain outcome:

```text
stale version
reload required
```

### 15.7 422 Unprocessable Entity

Sering berarti syntactically valid but semantically invalid.

```text
field valid JSON tapi business rule melarang
```

Retry:

```text
no, unless input changed
```

### 15.8 429 Too Many Requests

Makna:

```text
client exceeded rate limit
quota exhausted
burst rejected
```

Retry:

```text
yes only according to Retry-After / backoff / budget
```

Important:

```text
429 adalah feedback control signal, bukan sekadar error.
```

---

## 16. Mapping 5xx: Server Error Tidak Selalu Retryable

### 16.1 500 Internal Server Error

Makna:

```text
downstream internal failure
business exception leaked as 500
unknown state
```

Retry:

```text
maybe for idempotent request
careful for command request
```

### 16.2 502 Bad Gateway

Makna:

```text
gateway/proxy received invalid response from upstream
upstream crash
network/proxy issue
```

Retry:

```text
often retryable with backoff for idempotent operations
```

### 16.3 503 Service Unavailable

Makna:

```text
downstream unavailable
overloaded
maintenance
circuit open at gateway
```

Retry:

```text
maybe, respect Retry-After if present
```

### 16.4 504 Gateway Timeout

Makna:

```text
gateway timed out waiting for upstream
request may still be processing upstream
side effect unknown for commands
```

Retry:

```text
safe only with idempotency or read-only operations
```

Critical rule:

> 5xx bukan otomatis retryable. Retryability tergantung method semantics, idempotency key, request body repeatability, remaining deadline, and downstream contract.

---

## 17. Redirect, Authentication, dan Proxy Policy Failure

HTTP client sering punya automatic behavior:

```text
follow redirect
auth challenge handling
proxy authentication
connection retry
TLS renegotiation / route retry
```

Error policy bisa muncul dari automatic behavior ini.

Contoh:

```text
too many redirects
redirect from HTTPS to HTTP
redirect to disallowed host
proxy authentication required
proxy refused tunnel
```

Classification:

```text
kind: POLICY or SECURITY
retryable: usually no
operatorAction: inspect route/proxy/redirect policy
```

Security rule:

> Redirect harus melewati allowlist dan credential stripping policy. Jangan bawa Authorization header ke host berbeda.

---

## 18. Decode / Deserialization Failure

Decode failure terjadi ketika body diterima tetapi tidak bisa diubah menjadi object.

Contoh:

```text
invalid JSON
unexpected XML
wrong content-type
invalid charset
invalid enum value
invalid date format
BigDecimal precision issue
HTML error page instead of JSON
```

Makna:

```text
transport success
HTTP exchange success
representation unusable
```

Classification:

```text
phase: DECODE
kind: DECODE or SCHEMA
retryable: usually no
maybe retryable if downstream returned transient HTML 502 page with 200 status, but that is contract violation
```

Jangan fallback ke object kosong.

Bad:

```java
try {
    return mapper.readValue(body, CustomerDto.class);
} catch (Exception e) {
    return new CustomerDto();
}
```

Good:

```java
try {
    return mapper.readValue(body, CustomerDto.class);
} catch (JsonProcessingException e) {
    throw new ExternalResponseDecodeException(
            "customer-api returned an invalid JSON response",
            e
    );
}
```

Tetapi di boundary yang matang, jangan hanya throw. Classify.

```java
public record DecodeFailure(
        String clientName,
        String operation,
        int statusCode,
        String contentType,
        String safeBodySample,
        Throwable cause
) {}
```

---

## 19. Schema / Compatibility Failure

Schema failure lebih spesifik dari decode failure.

Decode bisa sukses secara JSON, tetapi schema tidak sesuai harapan.

Contoh:

```json
{
  "customer_id": "C-123",
  "status": "PENDING_MANUAL_REVIEW"
}
```

Jika enum Java hanya mengenal:

```java
ACTIVE, INACTIVE, SUSPENDED
```

Maka terjadi compatibility failure.

Jenis schema drift:

```text
new enum value
field removed
field changed type
nullable changed to required
numeric precision changed
date format changed
error envelope changed
pagination field changed
```

Best practice:

```text
unknown field → usually tolerate
missing required field → fail
unknown enum → map to UNKNOWN if domain allows
numeric money → BigDecimal, not double
external date/time → explicit OffsetDateTime/Instant parsing
```

Schema failure biasanya:

```text
retryable: no
owner: integration contract/governance
alert: yes if sudden spike
```

---

## 20. Semantic / Domain Failure

Semantic failure berarti downstream berhasil memproses request, tetapi outcome bisnis tidak sukses.

Contoh:

```text
payment declined
address not found
eligibility failed
quota exceeded
case already closed
document rejected
```

Ini harus dipetakan ke domain outcome, bukan generic external exception.

Bad:

```java
throw new RuntimeException("HTTP 422");
```

Better:

```java
return PaymentResult.declined(reasonCode, message);
```

Atau:

```java
throw new PaymentDeclinedException(reasonCode);
```

Tetapi untuk application service, typed result sering lebih eksplisit:

```java
public sealed interface PaymentAttemptResult permits
        PaymentAttemptResult.Approved,
        PaymentAttemptResult.Declined,
        PaymentAttemptResult.Unknown {

    record Approved(String paymentId) implements PaymentAttemptResult {}

    record Declined(String reasonCode, String safeMessage) implements PaymentAttemptResult {}

    record Unknown(String reasonCode, String safeMessage) implements PaymentAttemptResult {}
}
```

Catatan Java 8:

- sealed interface tidak tersedia.
- gunakan interface biasa + final classes, atau enum discriminator.

---

## 21. Client Policy Failure

Client policy failure terjadi karena client sendiri menolak eksekusi atau response berdasarkan policy internal.

Contoh:

```text
circuit breaker open
rate limiter rejected
bulkhead full
deadline already expired
request body too large
URL host not allowed
response body too large
redirect disallowed
```

Ini bukan downstream failure murni.

Classification:

```text
kind: POLICY
phase: POLICY
retryable: depends
countAsDownstreamFailure: usually no for breaker open / rate-limiter reject
```

Observability penting:

```text
external_api_call_total{outcome="client_policy_rejected", policy="bulkhead"}
```

Jika semua policy failure dihitung sebagai downstream 5xx, metric akan menyesatkan.

---

## 22. Security Classification Failure

Security failure adalah error yang berkaitan dengan trust boundary.

Contoh:

```text
SSRF blocked
redirect to non-allowlisted host
certificate pin mismatch
hostname verification failed
Authorization header would leak to different host
response content-type unexpected for sensitive endpoint
malicious header value detected
```

Biasanya:

```text
retryable: no
operator/security alert: maybe
safe user message: generic
log details: redacted
```

Security error jangan otomatis fallback diam-diam. Fallback diam-diam bisa menyembunyikan serangan atau misconfiguration.

---

## 23. Unknown / Unclassified Failure

Unknown failure harus tetap ada sebagai bucket terakhir.

Namun unknown tidak boleh menjadi bucket dominan.

Metric smell:

```text
external_client_error_total{kind="unknown"} is high
```

Artinya error model belum cukup tajam.

Rule:

```text
unknown allowed as safety net
unknown not allowed as default mental model
```

---

## 24. Exception vs Typed Result

Ada dua pendekatan besar:

```text
exception-oriented
result-oriented
```

### 24.1 Exception-Oriented

Cocok untuk:

```text
unexpected technical failure
programming error
infrastructure error
call stack short
framework integration yang exception-oriented
```

Contoh:

```java
try {
    Customer customer = customerClient.getCustomer(id);
} catch (ExternalServiceUnavailableException e) {
    // fallback or propagate
}
```

### 24.2 Result-Oriented

Cocok untuk:

```text
known domain outcome
partial success
unknown command outcome
workflow/state machine
regulatory/audit system
case management
```

Contoh:

```java
CustomerLookupResult result = customerClient.lookupCustomer(id);

switch (result.kind()) {
    case FOUND -> use(result.customer());
    case NOT_FOUND -> markNotFound();
    case TEMPORARILY_UNAVAILABLE -> scheduleRetry();
    case UNKNOWN -> escalateManualReview();
}
```

Java 8 version:

```java
public final class CustomerLookupResult {
    public enum Kind {
        FOUND,
        NOT_FOUND,
        TEMPORARILY_UNAVAILABLE,
        UNKNOWN
    }

    private final Kind kind;
    private final Customer customer;
    private final String reasonCode;

    private CustomerLookupResult(Kind kind, Customer customer, String reasonCode) {
        this.kind = kind;
        this.customer = customer;
        this.reasonCode = reasonCode;
    }

    public static CustomerLookupResult found(Customer customer) {
        return new CustomerLookupResult(Kind.FOUND, customer, null);
    }

    public static CustomerLookupResult notFound() {
        return new CustomerLookupResult(Kind.NOT_FOUND, null, "NOT_FOUND");
    }

    public static CustomerLookupResult temporarilyUnavailable(String reasonCode) {
        return new CustomerLookupResult(Kind.TEMPORARILY_UNAVAILABLE, null, reasonCode);
    }

    public static CustomerLookupResult unknown(String reasonCode) {
        return new CustomerLookupResult(Kind.UNKNOWN, null, reasonCode);
    }

    public Kind kind() { return kind; }
    public Customer customer() { return customer; }
    public String reasonCode() { return reasonCode; }
}
```

Guideline:

```text
technical unexpected failure → exception may be okay
expected business alternative → typed result is usually better
command with unknown outcome → typed result strongly recommended
```

---

## 25. Retryability Classification

Retryability harus menjadi hasil classification, bukan if-else tersebar.

```java
public enum RetryDecision {
    DO_NOT_RETRY,
    RETRY_IF_IDEMPOTENT,
    RETRY_WITH_IDEMPOTENCY_KEY,
    RETRY_AFTER,
    RETRY_IMMEDIATELY_NOT_RECOMMENDED,
    UNKNOWN
}
```

Contoh mapping:

```text
DNS failure
→ RETRY_IF_IDEMPOTENT

connect timeout
→ RETRY_IF_IDEMPOTENT

response timeout after POST without idempotency key
→ DO_NOT_RETRY or UNKNOWN requiring reconciliation

429 with Retry-After
→ RETRY_AFTER

401 expired token
→ refresh token once, then retry same request if safe by client policy

400 validation error
→ DO_NOT_RETRY

503 read-only GET
→ RETRY_IF_IDEMPOTENT
```

Retryability perlu mempertimbangkan:

```text
method
operation semantics
idempotency key
body repeatability
failure phase
status code
Retry-After
remaining deadline
attempt count
circuit/bulkhead state
```

---

## 26. Side Effect Risk Classification

Ini sangat penting untuk command operation.

```java
public enum SideEffectRisk {
    NONE,
    UNKNOWN,
    POSSIBLE,
    CONFIRMED
}
```

Mapping umum:

```text
request construction failed
→ NONE

DNS failed before connect
→ NONE

connect refused before write
→ NONE

write failed before any byte sent
→ NONE or UNKNOWN depending library visibility

write partially completed
→ UNKNOWN

response timeout after full request sent
→ UNKNOWN/POSSIBLE

HTTP 201 received
→ CONFIRMED

HTTP 409 duplicate idempotency key
→ CONFIRMED or DOMAIN_CONFLICT depending contract
```

Mengapa penting?

Karena command seperti ini:

```text
POST /payments
POST /case-actions/close
POST /notifications/send
POST /documents/submit
```

tidak boleh dianggap gagal total hanya karena client timeout.

Mungkin server sudah melakukan side effect.

Top-tier design:

```text
command timeout
→ outcome unknown
→ reconcile by operation id / idempotency key / status endpoint
→ do not blindly repeat
```

---

## 27. Error Envelope

Banyak API mengembalikan error body terstruktur.

Contoh:

```json
{
  "code": "ADDRESS_NOT_FOUND",
  "message": "Address cannot be found",
  "details": [
    {
      "field": "postalCode",
      "reason": "invalid_format"
    }
  ],
  "traceId": "abc-123"
}
```

Client harus memisahkan:

```text
external code
external message
safe internal reason
safe user message
correlation/trace id
field-level errors
downstream raw body sample
```

Jangan langsung tampilkan external message ke user jika:

```text
mengandung internal detail
mengandung PII
berasal dari untrusted third-party
bahasanya tidak sesuai UX
mengungkap security info
```

Model:

```java
public record ExternalErrorEnvelope(
        String externalCode,
        String externalMessage,
        String downstreamTraceId,
        Map<String, Object> details
) {}
```

Boundary translation:

```java
public record ClientErrorClassification(
        FailureKind kind,
        FailurePhase phase,
        RetryDecision retryDecision,
        SideEffectRisk sideEffectRisk,
        String internalReasonCode,
        String safeUserMessage,
        String downstreamTraceId
) {}
```

---

## 28. Safe Message vs Diagnostic Message

Setiap error minimal punya dua representasi:

```text
safe message
→ boleh tampil ke user atau higher-level caller

diagnostic message
→ hanya untuk log internal, redacted
```

Contoh buruk:

```text
Failed to call https://api.vendor.com/payment?token=abc123&customerNric=S1234567A
```

Contoh lebih aman:

```text
payment-api call failed during response wait phase; kind=TIMEOUT; operation=createPayment; attempt=1
```

Diagnostic structured fields:

```text
clientName
operation
method
host
pathTemplate, not raw path if contains sensitive id
statusCode
failureKind
failurePhase
retryDecision
sideEffectRisk
attempt
elapsedMs
timeoutBudgetMs
traceId
correlationId
downstreamTraceId
```

---

## 29. Error Classification Object: Java 17+ Example

```java
public record ExternalCallError(
        String clientName,
        String operation,
        FailureKind kind,
        FailurePhase phase,
        RetryDecision retryDecision,
        SideEffectRisk sideEffectRisk,
        Integer httpStatus,
        String externalCode,
        String safeMessage,
        String downstreamTraceId,
        long elapsedMillis,
        Throwable cause
) {
    public boolean retryableByPolicy() {
        return retryDecision == RetryDecision.RETRY_IF_IDEMPOTENT
                || retryDecision == RetryDecision.RETRY_WITH_IDEMPOTENCY_KEY
                || retryDecision == RetryDecision.RETRY_AFTER;
    }
}
```

Untuk Java 8, gunakan final class biasa.

```java
public final class ExternalCallError {
    private final String clientName;
    private final String operation;
    private final FailureKind kind;
    private final FailurePhase phase;
    private final RetryDecision retryDecision;
    private final SideEffectRisk sideEffectRisk;
    private final Integer httpStatus;
    private final String externalCode;
    private final String safeMessage;
    private final String downstreamTraceId;
    private final long elapsedMillis;
    private final Throwable cause;

    public ExternalCallError(
            String clientName,
            String operation,
            FailureKind kind,
            FailurePhase phase,
            RetryDecision retryDecision,
            SideEffectRisk sideEffectRisk,
            Integer httpStatus,
            String externalCode,
            String safeMessage,
            String downstreamTraceId,
            long elapsedMillis,
            Throwable cause
    ) {
        this.clientName = clientName;
        this.operation = operation;
        this.kind = kind;
        this.phase = phase;
        this.retryDecision = retryDecision;
        this.sideEffectRisk = sideEffectRisk;
        this.httpStatus = httpStatus;
        this.externalCode = externalCode;
        this.safeMessage = safeMessage;
        this.downstreamTraceId = downstreamTraceId;
        this.elapsedMillis = elapsedMillis;
        this.cause = cause;
    }

    public String getClientName() { return clientName; }
    public String getOperation() { return operation; }
    public FailureKind getKind() { return kind; }
    public FailurePhase getPhase() { return phase; }
    public RetryDecision getRetryDecision() { return retryDecision; }
    public SideEffectRisk getSideEffectRisk() { return sideEffectRisk; }
    public Integer getHttpStatus() { return httpStatus; }
    public String getExternalCode() { return externalCode; }
    public String getSafeMessage() { return safeMessage; }
    public String getDownstreamTraceId() { return downstreamTraceId; }
    public long getElapsedMillis() { return elapsedMillis; }
    public Throwable getCause() { return cause; }
}
```

---

## 30. Library-Specific Error Mapping

### 30.1 JDK HttpClient

Common failure surfaces:

```text
IOException
InterruptedException
CompletableFuture CompletionException
HttpTimeoutException
HttpConnectTimeoutException
SSLHandshakeException
UnknownHostException as cause
```

Synchronous example:

```java
try {
    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
    return classifyHttpResponse(response.statusCode(), response.body());
} catch (java.net.http.HttpConnectTimeoutException e) {
    return connectTimeout(e);
} catch (java.net.http.HttpTimeoutException e) {
    return responseTimeout(e);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return cancelled(e);
} catch (IOException e) {
    return classifyIOException(e);
}
```

Async example:

```java
CompletableFuture<HttpResponse<String>> future =
        client.sendAsync(request, HttpResponse.BodyHandlers.ofString());

return future.handle((response, failure) -> {
    if (failure != null) {
        Throwable actual = unwrapCompletionException(failure);
        return classifyThrowable(actual);
    }
    return classifyHttpResponse(response.statusCode(), response.body());
});
```

Unwrap:

```java
static Throwable unwrapCompletionException(Throwable t) {
    if (t instanceof java.util.concurrent.CompletionException && t.getCause() != null) {
        return t.getCause();
    }
    if (t instanceof java.util.concurrent.ExecutionException && t.getCause() != null) {
        return t.getCause();
    }
    return t;
}
```

### 30.2 OkHttp

Common failure surfaces:

```text
IOException from execute/enqueue
SocketTimeoutException
InterruptedIOException
UnknownHostException
SSLHandshakeException
ProtocolException
non-successful HTTP status is not thrown automatically
```

Important:

```java
try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        return classifyStatus(response.code(), safeReadErrorBody(response));
    }
    return decode(response.body());
}
```

OkHttp requires response body close. Failing to close causes connection leak.

### 30.3 Retrofit

Retrofit can expose:

```text
Call<T>.execute() returning Response<T>
IOException for transport failure
Response.errorBody() for non-2xx
converter exception for decode failure
adapter-specific wrapper for CompletableFuture/Rx/Reactor/etc
```

Example:

```java
try {
    retrofit2.Response<CustomerDto> response = api.getCustomer(id).execute();

    if (response.isSuccessful()) {
        CustomerDto body = response.body();
        if (body == null) return classifyEmptyBody();
        return mapSuccess(body);
    }

    String errorBody = response.errorBody() != null ? response.errorBody().string() : null;
    return classifyStatus(response.code(), errorBody);
} catch (IOException e) {
    return classifyIOException(e);
} catch (RuntimeException e) {
    return classifyDecodeOrAdapterFailure(e);
}
```

### 30.4 Apache HttpClient 5

Common surfaces:

```text
IOException
HttpException / ProtocolException
ConnectTimeoutException
ConnectionRequestTimeoutException
SocketTimeoutException
SSLException
ParseException / entity processing issues
```

Apache gives strong control over connection manager and request config, but you still need application-level classification.

---

## 31. HTTP Status Mapping Table

| Status / Failure | Typical Kind | Retry? | Side Effect Risk | Notes |
|---|---:|---:|---:|---|
| DNS failure | DNS/TRANSPORT | maybe | none for attempt | Backoff, check service discovery |
| Connect refused | CONNECTION | maybe | none | Downstream not accepting |
| TLS handshake failed | TLS/SECURITY | usually no | none | Trust/identity issue |
| Connect timeout | TIMEOUT | maybe | none | Server likely did not receive |
| Response timeout | TIMEOUT | maybe only if safe | unknown/possible | Dangerous for commands |
| 400 | HTTP_STATUS / CONTRACT | no | depends | Often caller bug or contract drift |
| 401 | AUTH | once after refresh | depends | Avoid refresh storm |
| 403 | AUTHZ/POLICY | no | none/depends | Scope/tenant/policy issue |
| 404 | DOMAIN or CONTRACT | depends | none | Could be normal not-found |
| 409 | DOMAIN_CONFLICT | not blind | possible/confirmed | Reconcile state |
| 412 | DOMAIN_CONFLICT | no | none/possible | Optimistic lock / ETag |
| 422 | DOMAIN_VALIDATION | no | none | Input/business validation |
| 429 | RATE_LIMIT | yes with Retry-After | none/depends | Must throttle |
| 500 | DOWNSTREAM | maybe | unknown | Depends on operation |
| 502 | GATEWAY | maybe | unknown | Usually transient |
| 503 | UNAVAILABLE | maybe | unknown | Respect Retry-After |
| 504 | GATEWAY_TIMEOUT | maybe if safe | unknown/possible | Server may still process |
| Decode error | DECODE/SCHEMA | usually no | confirmed response received | Contract issue |
| Circuit open | POLICY | no immediate | none | Not downstream call |
| Bulkhead full | POLICY | maybe later | none | Caller overload |

---

## 32. Avoiding Exception Hierarchy Explosion

A common mistake is creating too many exception classes:

```text
CustomerApiBadRequestException
CustomerApiUnauthorizedException
CustomerApiForbiddenException
CustomerApiNotFoundException
CustomerApiConflictException
CustomerApiTimeoutException
CustomerApiReadTimeoutException
CustomerApiWriteTimeoutException
CustomerApiDnsException
...
```

This becomes hard to maintain.

Prefer:

```text
small number of exception/result types
+ structured classification fields
```

Example:

```java
public final class ExternalCallException extends RuntimeException {
    private final ExternalCallError error;

    public ExternalCallException(ExternalCallError error) {
        super(error.getSafeMessage(), error.getCause());
        this.error = error;
    }

    public ExternalCallError error() {
        return error;
    }
}
```

This allows:

```java
catch (ExternalCallException e) {
    if (e.error().getRetryDecision() == RetryDecision.RETRY_AFTER) {
        // policy
    }
}
```

Without dozens of classes.

---

## 33. Domain Translation Pattern

External client adapter should translate external failures into application/domain-safe outcomes.

Layering:

```text
HTTP transport error
→ client classification
→ external client outcome
→ application use-case decision
→ domain state transition / user response / retry queue
```

Example for address lookup:

```java
public interface AddressLookupPort {
    AddressLookupResult lookupByPostalCode(String postalCode);
}
```

```java
public final class AddressLookupHttpAdapter implements AddressLookupPort {
    private final ExternalAddressClient client;

    public AddressLookupHttpAdapter(ExternalAddressClient client) {
        this.client = client;
    }

    @Override
    public AddressLookupResult lookupByPostalCode(String postalCode) {
        ExternalClientResult<AddressDto> result = client.lookup(postalCode);

        if (result.isSuccess()) {
            return AddressLookupResult.found(map(result.value()));
        }

        ExternalCallError error = result.error();

        if (error.getHttpStatus() != null && error.getHttpStatus() == 404) {
            return AddressLookupResult.notFound();
        }

        if (error.getKind() == FailureKind.TIMEOUT || error.getKind() == FailureKind.CONNECTION) {
            return AddressLookupResult.temporarilyUnavailable(error.getSafeMessage());
        }

        return AddressLookupResult.unknown(error.getSafeMessage());
    }
}
```

Important:

```text
Application layer should not need to know UnknownHostException, SSLHandshakeException, or Retrofit Response.errorBody().
```

---

## 34. Error Model for Command APIs

Command API is different from query API.

Query:

```text
GET /address?postalCode=123456
```

If timeout happens, caller can usually retry.

Command:

```text
POST /case/{id}/close
POST /payment
POST /send-email
POST /submit-document
```

If timeout happens after request is sent:

```text
client does not know whether command committed
```

Therefore, command client should include:

```text
idempotency key
client operation id
status/reconciliation endpoint
outbox record
unknown outcome state
manual review path if required
```

Command result model:

```java
public enum CommandOutcomeKind {
    ACCEPTED,
    REJECTED,
    DUPLICATE,
    CONFLICT,
    UNKNOWN,
    NOT_SENT
}
```

```java
public final class CommandOutcome {
    private final CommandOutcomeKind kind;
    private final String externalReference;
    private final String reasonCode;
    private final boolean reconciliationRequired;

    private CommandOutcome(
            CommandOutcomeKind kind,
            String externalReference,
            String reasonCode,
            boolean reconciliationRequired
    ) {
        this.kind = kind;
        this.externalReference = externalReference;
        this.reasonCode = reasonCode;
        this.reconciliationRequired = reconciliationRequired;
    }

    public static CommandOutcome accepted(String externalReference) {
        return new CommandOutcome(CommandOutcomeKind.ACCEPTED, externalReference, null, false);
    }

    public static CommandOutcome unknown(String reasonCode) {
        return new CommandOutcome(CommandOutcomeKind.UNKNOWN, null, reasonCode, true);
    }

    public CommandOutcomeKind kind() { return kind; }
    public String externalReference() { return externalReference; }
    public String reasonCode() { return reasonCode; }
    public boolean reconciliationRequired() { return reconciliationRequired; }
}
```

Top-tier invariant:

> For side-effecting operations, timeout is not equivalent to failure. It is often unknown outcome.

---

## 35. Observability Design for Error Model

Every classified failure should emit structured telemetry.

Suggested metrics:

```text
external_http_client_requests_total{
  client,
  operation,
  method,
  outcome,
  failure_kind,
  failure_phase,
  status_class,
  retry_decision
}

external_http_client_request_duration_seconds{
  client,
  operation,
  method,
  outcome
}

external_http_client_retries_total{
  client,
  operation,
  reason
}

external_http_client_unknown_outcomes_total{
  client,
  operation,
  side_effect_risk
}

external_http_client_decode_failures_total{
  client,
  operation,
  content_type
}
```

Avoid high-cardinality labels:

```text
raw URL
customer id
request id
exception message
external error message
full path with identifiers
```

Logs should include correlation IDs but not secrets/PII.

Example structured log:

```json
{
  "event": "external_http_call_failed",
  "client": "payment-api",
  "operation": "createPayment",
  "method": "POST",
  "pathTemplate": "/payments",
  "failureKind": "TIMEOUT",
  "failurePhase": "WAIT_RESPONSE",
  "retryDecision": "DO_NOT_RETRY",
  "sideEffectRisk": "UNKNOWN",
  "attempt": 1,
  "elapsedMs": 2800,
  "deadlineMs": 3000,
  "correlationId": "...",
  "downstreamTraceId": null
}
```

---

## 36. Audit Trail vs Debug Log

Dalam sistem enterprise/regulatory, tidak semua error cukup masuk log.

Beberapa outcome perlu audit:

```text
external command accepted
external command rejected
external command unknown outcome
manual reconciliation required
security policy blocked request
identity/auth mismatch
external system returned business rejection
```

Debug log menjawab:

```text
apa yang terjadi secara teknis?
```

Audit trail menjawab:

```text
keputusan apa yang dibuat sistem, berdasarkan informasi apa, dan dampaknya apa?
```

Contoh audit event:

```json
{
  "eventType": "EXTERNAL_COMMAND_OUTCOME_UNKNOWN",
  "caseId": "CASE-123",
  "operation": "submitDocument",
  "externalSystem": "document-gateway",
  "clientOperationId": "op-789",
  "reason": "RESPONSE_TIMEOUT_AFTER_REQUEST_SENT",
  "reconciliationRequired": true,
  "timestamp": "2026-06-18T10:15:30Z"
}
```

---

## 37. Testing Error Classification

Error classification harus dites, bukan diasumsikan.

Test cases:

```text
DNS failure maps to DNS phase
connect timeout maps to CONNECT/TIMEOUT
read timeout maps to READ_RESPONSE/TIMEOUT
HTTP 404 for lookup maps to notFound
HTTP 404 for command endpoint maps to client/protocol failure
HTTP 401 triggers refresh only once
HTTP 429 respects Retry-After
HTTP 500 retry only for idempotent operation
malformed JSON maps to DECODE
unknown enum maps to SCHEMA or UNKNOWN enum depending policy
response body too large maps to POLICY
circuit open maps to POLICY, not downstream failure
```

Using MockWebServer/WireMock you can simulate:

```text
normal response
HTTP error response
malformed body
slow response
disconnect during response body
throttled response
large body
```

For pure classifier, no HTTP server needed:

```java
@Test
void status429ShouldBeRetryAfterWhenHeaderPresent() {
    ErrorClassifier classifier = new ErrorClassifier();

    Classification result = classifier.classifyHttpStatus(
            "vendor-api",
            "search",
            "GET",
            429,
            Map.of("Retry-After", List.of("30")),
            "{\"code\":\"RATE_LIMITED\"}"
    );

    assertEquals(FailureKind.HTTP_STATUS, result.kind());
    assertEquals(RetryDecision.RETRY_AFTER, result.retryDecision());
}
```

---

## 38. Common Anti-Patterns

### 38.1 Treating every non-2xx as exception

Bad because 404/409/422 can be domain outcomes.

### 38.2 Treating every exception as retryable

Bad because TLS, 400, schema errors, and security policy blocks are not solved by retry.

### 38.3 Retrying command timeout blindly

Can create duplicate payments, duplicate emails, duplicate workflow actions.

### 38.4 Losing failure phase

`IOException` alone is not enough.

### 38.5 Logging raw response body

Can leak PII, token, sensitive business data.

### 38.6 Using external error message as user message

Can leak internals or create inconsistent UX.

### 38.7 Mapping decode failure to empty DTO

Can create silent data corruption.

### 38.8 Counting circuit-open as downstream 5xx

Misleads incident diagnosis.

### 38.9 Ignoring unknown outcome

A timeout after request sent is not the same as operation failed.

### 38.10 Exception hierarchy explosion

Too many exception classes make policy logic scattered and brittle.

---

## 39. Production-Grade Error Classifier Skeleton

```java
public final class ExternalErrorClassifier {

    public ExternalCallError classifyThrowable(
            String clientName,
            String operation,
            Throwable throwable,
            long elapsedMillis
    ) {
        Throwable t = unwrap(throwable);

        if (isDnsFailure(t)) {
            return error(clientName, operation, FailureKind.DNS, FailurePhase.DNS,
                    RetryDecision.RETRY_IF_IDEMPOTENT, SideEffectRisk.NONE, elapsedMillis, t,
                    "External service name could not be resolved");
        }

        if (isTlsFailure(t)) {
            return error(clientName, operation, FailureKind.TLS, FailurePhase.TLS,
                    RetryDecision.DO_NOT_RETRY, SideEffectRisk.NONE, elapsedMillis, t,
                    "Secure connection to external service failed");
        }

        if (isTimeout(t)) {
            return error(clientName, operation, FailureKind.TIMEOUT, FailurePhase.UNKNOWN,
                    RetryDecision.RETRY_IF_IDEMPOTENT, SideEffectRisk.UNKNOWN, elapsedMillis, t,
                    "External service timed out");
        }

        if (isConnectionFailure(t)) {
            return error(clientName, operation, FailureKind.CONNECTION, FailurePhase.CONNECT,
                    RetryDecision.RETRY_IF_IDEMPOTENT, SideEffectRisk.NONE, elapsedMillis, t,
                    "External service connection failed");
        }

        return error(clientName, operation, FailureKind.UNKNOWN, FailurePhase.UNKNOWN,
                RetryDecision.UNKNOWN, SideEffectRisk.UNKNOWN, elapsedMillis, t,
                "External service call failed");
    }

    public ExternalCallError classifyStatus(
            String clientName,
            String operation,
            String method,
            int status,
            Map<String, List<String>> headers,
            String errorBody,
            long elapsedMillis
    ) {
        if (status == 401) {
            return statusError(clientName, operation, status, FailureKind.HTTP_STATUS,
                    RetryDecision.RETRY_WITH_IDEMPOTENCY_KEY, SideEffectRisk.UNKNOWN,
                    "External service authentication failed", elapsedMillis);
        }

        if (status == 404 && "GET".equalsIgnoreCase(method)) {
            return statusError(clientName, operation, status, FailureKind.DOMAIN,
                    RetryDecision.DO_NOT_RETRY, SideEffectRisk.NONE,
                    "Requested external resource was not found", elapsedMillis);
        }

        if (status == 429) {
            return statusError(clientName, operation, status, FailureKind.HTTP_STATUS,
                    RetryDecision.RETRY_AFTER, SideEffectRisk.UNKNOWN,
                    "External service rate limit was reached", elapsedMillis);
        }

        if (status >= 500) {
            return statusError(clientName, operation, status, FailureKind.HTTP_STATUS,
                    RetryDecision.RETRY_IF_IDEMPOTENT, SideEffectRisk.UNKNOWN,
                    "External service is temporarily unavailable", elapsedMillis);
        }

        if (status >= 400) {
            return statusError(clientName, operation, status, FailureKind.HTTP_STATUS,
                    RetryDecision.DO_NOT_RETRY, SideEffectRisk.UNKNOWN,
                    "External service rejected the request", elapsedMillis);
        }

        throw new IllegalArgumentException("status is not an error: " + status);
    }

    private static Throwable unwrap(Throwable t) {
        if (t instanceof java.util.concurrent.CompletionException && t.getCause() != null) {
            return t.getCause();
        }
        if (t instanceof java.util.concurrent.ExecutionException && t.getCause() != null) {
            return t.getCause();
        }
        return t;
    }

    private static boolean isDnsFailure(Throwable t) {
        return hasCause(t, java.net.UnknownHostException.class);
    }

    private static boolean isTlsFailure(Throwable t) {
        return hasCause(t, javax.net.ssl.SSLException.class);
    }

    private static boolean isTimeout(Throwable t) {
        return hasCause(t, java.net.SocketTimeoutException.class)
                || hasCause(t, java.net.http.HttpTimeoutException.class)
                || hasCause(t, java.io.InterruptedIOException.class);
    }

    private static boolean isConnectionFailure(Throwable t) {
        return hasCause(t, java.net.ConnectException.class)
                || hasCause(t, java.net.NoRouteToHostException.class)
                || hasCause(t, java.net.SocketException.class);
    }

    private static boolean hasCause(Throwable t, Class<? extends Throwable> type) {
        Throwable current = t;
        while (current != null) {
            if (type.isInstance(current)) return true;
            current = current.getCause();
        }
        return false;
    }

    private static ExternalCallError error(
            String clientName,
            String operation,
            FailureKind kind,
            FailurePhase phase,
            RetryDecision retryDecision,
            SideEffectRisk sideEffectRisk,
            long elapsedMillis,
            Throwable cause,
            String safeMessage
    ) {
        return new ExternalCallError(
                clientName,
                operation,
                kind,
                phase,
                retryDecision,
                sideEffectRisk,
                null,
                null,
                safeMessage,
                null,
                elapsedMillis,
                cause
        );
    }

    private static ExternalCallError statusError(
            String clientName,
            String operation,
            int status,
            FailureKind kind,
            RetryDecision retryDecision,
            SideEffectRisk sideEffectRisk,
            String safeMessage,
            long elapsedMillis
    ) {
        return new ExternalCallError(
                clientName,
                operation,
                kind,
                FailurePhase.HTTP_STATUS,
                retryDecision,
                sideEffectRisk,
                status,
                null,
                safeMessage,
                null,
                elapsedMillis,
                null
        );
    }
}
```

This skeleton is intentionally not perfect. It is a starting architecture. In real production code, you should enrich classification with:

```text
operation semantics
idempotency metadata
request body repeatability
failure phase from library instrumentation
Retry-After parsing
external error body parsing
safe body sample
correlation ID
attempt number
```

---

## 40. Design Review Questions

Use these questions when reviewing an HTTP client integration.

### 40.1 Classification

```text
Can the client distinguish transport failure from HTTP status error?
Can it distinguish timeout before connect from timeout after request sent?
Can it distinguish decode failure from business rejection?
Is 404 always error, or operation-specific?
Is 409 mapped to conflict/reconciliation where appropriate?
Is 429 handled as rate-limit signal?
```

### 40.2 Retry and Side Effect

```text
Does retry decision depend on idempotency?
Are POST retries protected by idempotency key?
Are command timeouts represented as unknown outcome?
Is request body repeatability considered?
Is Retry-After respected?
```

### 40.3 Observability

```text
Are failure_kind and failure_phase emitted as metrics/log fields?
Are raw URLs and PII avoided in logs?
Is downstream trace id captured?
Is unknown outcome counted separately?
Are circuit-open and bulkhead rejection separated from downstream failure?
```

### 40.4 Domain Boundary

```text
Does application layer see domain outcome instead of HTTP details?
Are external DTOs isolated?
Are external error codes translated?
Is user message safe?
Is audit event generated for material external outcomes?
```

### 40.5 Security

```text
Are TLS/certificate failures visible as security/trust failures?
Are redirects validated?
Are credentials stripped on host change?
Are response bodies redacted?
Are security policy blocks not silently swallowed?
```

---

## 41. Practical Heuristics

1. **A timeout after request was sent is not failure; it is unknown outcome.**
2. **HTTP status is not domain meaning until mapped by operation context.**
3. **Do not let transport exceptions escape into application use case.**
4. **Retryability is a classification result, not a status-code table only.**
5. **Side-effect risk matters more than method name.**
6. **404 can be normal for lookup and fatal for command endpoint.**
7. **429 is feedback, not just failure.**
8. **Decode failure is contract failure; do not default it silently.**
9. **Safe user message and diagnostic message must be separated.**
10. **Unknown bucket is acceptable only if it stays rare.**
11. **Audit significant external outcomes, not only technical failures.**
12. **Classification should be tested as first-class business logic.**

---

## 42. Summary

A production-grade HTTP client needs more than request execution. It needs a robust error model.

The key model:

```text
failure phase
+ failure kind
+ retry decision
+ side effect risk
+ HTTP status
+ external error code
+ safe message
+ diagnostic context
+ domain translation
```

The difference between average and top-tier engineering is visible here.

Average client:

```text
try call API
if status != 200 throw exception
retry sometimes
log exception message
```

Top-tier client:

```text
classify failure precisely
preserve side-effect uncertainty
map HTTP outcome to domain outcome
respect retry/idempotency/deadline
emit structured telemetry
redact sensitive data
support audit/reconciliation
make failure mode testable
```

That is the level needed when HTTP calls participate in serious distributed systems, enterprise workflows, financial operations, case management, compliance, or regulated decisions.

---

## 43. Materi Berikutnya

Part berikutnya:

```text
Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction
File: 21-observability-logging-metrics-tracing-correlation-redaction.md
```

Part 21 akan membahas bagaimana semua classification dan lifecycle HTTP client diterjemahkan menjadi logging, metrics, tracing, redaction, dan operational visibility yang benar.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer](./19-api-client-architecture-port-adapter-gateway-sdk-acl.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction](./21-observability-logging-metrics-tracing-correlation-redaction.md)
