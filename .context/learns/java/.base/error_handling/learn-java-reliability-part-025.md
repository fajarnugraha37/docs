# learn-java-reliability-part-025.md

# Part 025 — Security and Compliance in Error Handling

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 025 / 030  
> Fokus: bagaimana error handling menjadi bagian dari security boundary, compliance evidence, audit defensibility, dan operational trust.

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya, kita sudah membahas error handling dari sisi semantic correctness, graceful shutdown, retry, timeout, idempotency, observability, dan incident response.

Bagian ini fokus pada sisi yang sering dianggap “tambahan”, padahal sangat fundamental:

> Error handling adalah bagian dari security architecture.

Banyak vulnerability, audit finding, dan incident compliance bukan terjadi karena sistem tidak punya `try-catch`, tetapi karena error handling:

- membocorkan stack trace;
- membocorkan token atau PII;
- membedakan user valid vs invalid;
- gagal secara “open” pada authorization/authentication;
- menulis audit log yang tidak lengkap;
- menghapus evidence penting;
- mencatat data terlalu sensitif;
- membuat error response yang membantu attacker;
- membuat operator tidak bisa membuktikan apa yang terjadi;
- menyamarkan failure sebagai success;
- tidak punya tamper-resistance atau retention discipline.

OWASP menekankan bahwa improper error handling dapat mengungkap informasi internal aplikasi, logic, configuration, atau titik serangan; OWASP Logging Cheat Sheet juga menekankan bahwa log harus dilindungi dari penyalahgunaan, perubahan tidak sah, dan exposure karena log dapat memuat data sensitif. Referensi utama bagian ini:

- OWASP Improper Error Handling: <https://owasp.org/www-community/Improper_Error_Handling>
- OWASP Error Handling Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html>
- OWASP Logging Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- OWASP Top 10 2025 A10 Mishandling of Exceptional Conditions: <https://owasp.org/Top10/2025/A10_2025-Mishandling_of_Exceptional_Conditions/>
- NIST SP 800-92 Guide to Computer Security Log Management: <https://nvlpubs.nist.gov/nistpubs/legacy/SP/nistspecialpublication800-92.Pdf>
- NIST SP 800-61 Computer Security Incident Handling Guide: <https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-61r2.pdf>
- RFC 9457 Problem Details: <https://www.rfc-editor.org/rfc/rfc9457.html>
- Spring Boot error handling configuration: <https://docs.spring.io/spring-boot/>

---

## 1. Core Problem

Banyak engineer memahami error handling sebagai:

```java
try {
    doSomething();
} catch (Exception e) {
    log.error("Failed", e);
    throw e;
}
```

Dalam konteks security dan compliance, ini terlalu dangkal.

Pertanyaan yang lebih benar adalah:

1. Apakah error response membocorkan informasi internal?
2. Apakah error response membantu attacker melakukan enumeration?
3. Apakah error response memperlihatkan teknologi, table, schema, path, class, package, hostname, pod name, atau stack trace?
4. Apakah log mengandung PII, token, secret, cookie, authorization header, credential, private key, session id, atau personal identifier?
5. Apakah audit log tetap ditulis saat business operation gagal?
6. Apakah audit log membedakan user mistake, malicious attempt, system failure, dan operator action?
7. Apakah error handling fail-closed pada security decision?
8. Apakah dependency failure menyebabkan authorization bypass?
9. Apakah failure pada logging/audit pipeline menyebabkan evidence loss?
10. Apakah operator bisa membuktikan apa yang terjadi setelah incident?
11. Apakah data error retention sesuai policy?
12. Apakah correlation id aman untuk diekspos?
13. Apakah error code stabil tetapi tidak terlalu informatif untuk attacker?
14. Apakah exception translation mempertahankan forensic evidence tanpa bocor ke client?

Error handling yang buruk sering berada di antara dua ekstrem:

```text
Terlalu banyak dibuka ke client
  -> attacker mendapat evidence internal

Terlalu sedikit disimpan secara internal
  -> operator tidak bisa investigasi
```

Top-tier design membutuhkan dual-channel model:

```text
External error response:
  minimal, stable, safe, client-actionable

Internal evidence:
  rich, correlated, access-controlled, redactable, auditable
```

---

## 2. Mental Model: Error Handling sebagai Security Boundary

Setiap failure melewati beberapa boundary:

```text
Internal exception
      |
      v
Exception translation
      |
      +--> Client-facing response
      |
      +--> Application log
      |
      +--> Security/audit log
      |
      +--> Metrics/traces
      |
      +--> Alert/incident event
      |
      +--> Support ticket / manual review
```

Kesalahan umum adalah menganggap semua channel boleh berisi informasi yang sama.

Padahal setiap channel punya audience dan risk berbeda:

| Channel | Audience | Tujuan | Risiko |
|---|---:|---|---|
| API response | client/user | memberitahu hasil/aksi berikutnya | data leakage, enumeration |
| Application log | engineer/operator | debugging/incident investigation | PII leakage, secret leakage |
| Audit log | auditor/security/operator | evidence, accountability, compliance | tampering, incompleteness |
| Metrics | SRE/operator | aggregate health signal | high-cardinality PII/error explosion |
| Trace | engineer/SRE | causality, latency path | propagation of sensitive attrs |
| Alert | on-call | urgent action | noise, sensitive notification leakage |
| Support UI | support team | assisted remediation | privilege escalation / overexposure |

Mental model yang aman:

> Jangan pernah langsung memindahkan exception internal menjadi response eksternal. Selalu lakukan classification, translation, redaction, correlation, dan access separation.

---

## 3. Threat Model untuk Error Handling

Error handling bisa disalahgunakan attacker untuk beberapa tujuan.

### 3.1 Information Disclosure

Attacker memicu error untuk melihat detail internal:

```json
{
  "timestamp": "2026-06-16T10:12:01Z",
  "status": 500,
  "error": "Internal Server Error",
  "trace": "java.sql.SQLSyntaxErrorException: ORA-00942: table or view does not exist...",
  "path": "/api/internal/case/approve"
}
```

Masalah:

- menunjukkan database vendor;
- menunjukkan SQL error;
- menunjukkan endpoint internal;
- menunjukkan bahwa endpoint approve ada;
- mungkin menunjukkan schema/table/class;
- memberi attacker input untuk eksploitasi berikutnya.

Client response seharusnya minimal:

```json
{
  "type": "https://example.gov/problems/internal-error",
  "title": "Request could not be processed",
  "status": 500,
  "code": "SYSTEM.UNEXPECTED_ERROR",
  "correlationId": "01JZ..."
}
```

Detail internal tetap dicatat di log internal yang access-controlled.

---

### 3.2 Account Enumeration

Contoh buruk:

```json
// Login dengan email tidak terdaftar
{
  "code": "AUTH.EMAIL_NOT_REGISTERED",
  "message": "Email is not registered"
}

// Login dengan password salah
{
  "code": "AUTH.INVALID_PASSWORD",
  "message": "Password is incorrect"
}
```

Masalah:

- attacker bisa membedakan akun valid vs invalid;
- membuka jalan credential stuffing;
- membuka user enumeration.

Response eksternal lebih aman:

```json
{
  "code": "AUTH.INVALID_CREDENTIALS",
  "message": "Invalid credentials"
}
```

Internal security log boleh lebih detail:

```json
{
  "eventType": "AUTH_LOGIN_FAILED",
  "reason": "UNKNOWN_ACCOUNT",
  "normalizedUsernameHash": "...",
  "ipHash": "...",
  "correlationId": "..."
}
```

Perhatikan: detail boleh disimpan internal, tetapi harus tetap memperhatikan PII minimization.

---

### 3.3 Authorization Oracle

Contoh buruk:

```text
GET /cases/CASE-001 -> 403 Forbidden
GET /cases/CASE-999 -> 404 Not Found
```

Jika user tidak punya akses, response berbeda bisa membocorkan apakah resource ada.

Untuk resource-sensitive system, kadang response lebih aman:

```text
404 Not Found
```

untuk dua kondisi:

- resource tidak ada;
- resource ada tetapi user tidak boleh mengetahui keberadaannya.

Namun internal audit harus tetap membedakan:

```text
RESOURCE_ACCESS_DENIED_EXISTING_RESOURCE
```

Trade-off:

| Strategy | Kelebihan | Risiko |
|---|---|---|
| 403 untuk unauthorized | jelas untuk client resmi | bisa membocorkan existence |
| 404 masking | mengurangi enumeration | client sulit membedakan typo vs no access |
| 403 dengan generic message | bagus untuk internal app | masih bisa menjadi oracle jika dibandingkan dengan 404 |

Rule praktis:

> Untuk resource yang keberadaannya sensitif, jangan jadikan error response sebagai existence oracle.

---

### 3.4 Privilege Failure Turning into Bypass

Contoh buruk:

```java
boolean allowed;
try {
    allowed = authorizationClient.isAllowed(userId, action, resourceId);
} catch (Exception e) {
    log.warn("Authorization service failed, allowing temporarily", e);
    allowed = true;
}

if (!allowed) {
    throw new ForbiddenException();
}
```

Ini adalah fail-open pada security-critical decision.

Untuk authorization:

```java
boolean allowed;
try {
    allowed = authorizationClient.isAllowed(userId, action, resourceId);
} catch (Exception e) {
    log.error("Authorization service unavailable", e);
    throw new ServiceUnavailableException("Authorization could not be verified");
}

if (!allowed) {
    throw new ForbiddenException();
}
```

Rule:

> Jika sistem tidak bisa membuktikan user boleh melakukan sesuatu, default-nya harus deny atau unavailable, bukan allow.

---

### 3.5 Log Injection

Contoh buruk:

```java
log.info("Login failed for username=" + username);
```

Jika username berisi newline atau control characters:

```text
alice
INFO User admin logged in successfully
```

log bisa dimanipulasi.

Mitigasi:

- structured logging;
- encode/escape control characters;
- sanitize newline/tab;
- batasi panjang field;
- jangan log raw untrusted input;
- simpan hash/fingerprint untuk identifier sensitif.

Contoh aman:

```java
log.warn("login failed",
        kv("event", "AUTH_LOGIN_FAILED"),
        kv("username_hash", hashUsername(username)),
        kv("client_ip_hash", hashIp(clientIp)),
        kv("correlation_id", correlationId));
```

---

### 3.6 Secret Leakage via Exception Message

Banyak library exception membawa detail request.

Contoh berbahaya:

```text
GET https://api.example.com/token?client_secret=abc123 failed with 401
```

atau:

```text
Authorization: Bearer eyJhbGciOi...
```

atau:

```text
jdbc:postgresql://host/db?user=admin&password=secret
```

Jangan menganggap `exception.getMessage()` aman.

Rule:

> Message exception internal tidak otomatis aman untuk response maupun log.

Gunakan sanitizer/redactor di boundary logging dan HTTP client error handling.

---

## 4. Taxonomy Security-Sensitive Error

Tidak semua error punya security sensitivity yang sama.

| Category | External Response | Internal Log | Audit/Security Event |
|---|---|---|---|
| Validation error | detail field aman | low severity | biasanya tidak perlu, kecuali abuse |
| Auth failed | generic | reason internal | yes |
| Authorization denied | generic/403/404 mask | exact policy failure | yes |
| Rate limit | generic + retry info | source/ip/client id | yes if abuse |
| Suspicious input | generic validation/security | payload fingerprint | yes |
| Internal bug | generic 500 | stack trace internal | maybe incident |
| DB constraint | conflict/validation | constraint class, not raw data | depends |
| Data integrity breach | generic/system error | high severity | yes |
| Audit write failure | often fail-closed | critical | yes |
| Token refresh failure | 503 or auth failure | provider reason | yes if auth-boundary |
| Signature verification failure | 401/400 generic | algorithm/key id fingerprint | yes |
| Deserialization failure | 400 generic | parser error sanitized | maybe security |
| File upload scanning unavailable | 503/fail-closed | scanner failure | yes |
| Encryption/decryption failure | generic | key id/fingerprint, no plaintext | yes |

Kunci penting:

> Classification menentukan response, log level, audit event, alerting, dan remediation path.

---

## 5. Data Sensitivity: Apa yang Tidak Boleh Bocor

### 5.1 Jangan Bocorkan ke Client

Client-facing error tidak boleh memuat:

- stack trace;
- class name internal;
- package name;
- SQL statement;
- DB constraint name jika mengandung nama kolom/sistem internal;
- table/schema name;
- host/IP internal;
- pod name;
- container id;
- filesystem path;
- username internal;
- service account;
- AWS account id jika tidak perlu;
- S3 bucket internal;
- queue/topic internal;
- Redis key;
- JWT content;
- token;
- session id;
- password hint;
- cryptographic key id yang sensitif;
- raw provider response yang berisi data personal;
- full external provider error if provider leaks internals.

### 5.2 Jangan Log Mentah

Application log umumnya tidak boleh memuat:

- password;
- client secret;
- access token;
- refresh token;
- ID token;
- API key;
- private key;
- authorization header;
- cookie/session id;
- OTP;
- magic login link;
- reset password link;
- full credit card;
- bank account details;
- government identifier mentah;
- full address jika tidak diperlukan;
- full document content;
- file binary/base64;
- raw personal payload;
- medical/financial/legal sensitive data;
- private notes jika tidak diperlukan.

OWASP Logging Cheat Sheet secara eksplisit mengingatkan bahwa log dapat memuat personal dan sensitive information dan harus dilindungi dari akses/modifikasi/penghapusan tidak sah.

### 5.3 Data yang Boleh Dicatat dengan Kontrol

Boleh dicatat jika ada kebutuhan operasional/compliance, tetapi sebaiknya:

- masked;
- hashed;
- tokenized;
- truncated;
- encrypted at rest;
- access-controlled;
- retention-limited;
- purpose-limited.

Contoh:

```text
email: f***@example.com
nric: S****123A
accountIdHash: sha256(salt + accountId)
ipPrefix: 203.0.113.0/24
requestBodyHash: sha256(canonicalBody)
documentId: DOC-12345
caseId: CASE-2026-0001
```

Catatan: hash untuk PII harus hati-hati. Jika domain input kecil, hash tanpa salt bisa brute-forced.

---

## 6. External Error Response Design yang Aman

Gunakan prinsip:

```text
Safe externally, useful internally.
```

Contoh response dengan Problem Details style:

```json
{
  "type": "https://api.example.gov/problems/authorization-denied",
  "title": "Action is not allowed",
  "status": 403,
  "code": "SECURITY.ACTION_NOT_ALLOWED",
  "correlationId": "01JZ1X6V7N8P2Q3R4S5T6U7V8W"
}
```

Jangan:

```json
{
  "message": "User fajar@example.com does not have ACEAS_APPROVER role for CaseEntity(id=123) because policy module case.approve.v2 returned deny at com.xxx.auth.PolicyEvaluator line 182"
}
```

### 6.1 Field yang Umumnya Aman

| Field | Aman? | Catatan |
|---|---:|---|
| `type` | yes | stable URI, jangan expose internals |
| `title` | yes | generic |
| `status` | yes | HTTP semantics |
| `code` | yes | stable, jangan terlalu granular untuk security |
| `correlationId` | yes | pastikan bukan secret dan tidak predictable-sensitive |
| `message` | conditional | jangan detail internal |
| `fieldErrors` | conditional | hanya untuk validation input user |
| `retryable` | conditional | bisa membantu client, tapi jangan bocorkan security state |
| `retryAfter` | conditional | berguna untuk 429/503 |
| `details` | risky | hindari untuk public API |
| `debug` | no | jangan untuk production |
| `stackTrace` | no | jangan untuk client |
| `exception` | no | jangan untuk client |
| `sql` | no | jangan untuk client |

### 6.2 Stable Code vs Security Granularity

Jangan membuat public error code terlalu granular pada auth/security.

Buruk:

```text
AUTH.USER_NOT_FOUND
AUTH.PASSWORD_WRONG
AUTH.ACCOUNT_EXISTS_BUT_DISABLED
AUTH.ACCOUNT_LOCKED_BY_ADMIN
AUTH.MFA_DEVICE_EXISTS
AUTH.MFA_DEVICE_NOT_REGISTERED
```

Lebih aman eksternal:

```text
AUTH.INVALID_CREDENTIALS
AUTH.ACCESS_NOT_ALLOWED
AUTH.AUTHENTICATION_REQUIRED
AUTH.VERIFICATION_REQUIRED
```

Internal log/audit boleh memuat reason lebih granular dengan akses terbatas.

---

## 7. Fail-Closed untuk Security Decisions

### 7.1 Authentication

Jika authentication provider tidak bisa diverifikasi:

```text
Fail closed or unavailable.
```

Jangan allow hanya karena IdP timeout.

### 7.2 Authorization

Jika policy engine gagal:

```text
Deny or service unavailable.
```

Jangan allow.

### 7.3 Token Validation

Jika JWKS unavailable:

- token yang sudah bisa diverifikasi dengan cached key mungkin boleh dilanjutkan dalam bounded policy;
- token baru yang tidak bisa diverifikasi harus ditolak;
- jangan accept token unsigned atau skip signature validation.

### 7.4 Audit Logging

Untuk operasi compliance-critical:

- jika audit log wajib untuk legal defensibility, audit failure bisa harus fail-closed;
- jika audit pipeline async, gunakan durable outbox/local buffer;
- jangan silently ignore audit write failure.

### 7.5 File/Malware Scanning

Jika scan service unavailable:

- jangan mark file safe;
- gunakan `PENDING_SCAN`, `SCAN_UNAVAILABLE`, atau block download;
- fail-closed untuk file yang belum terbukti aman.

### 7.6 Encryption/Decryption

Jika key service gagal:

- jangan fallback ke plaintext;
- jangan disable encryption;
- return unavailable/internal error;
- log key alias/fingerprint, bukan secret.

---

## 8. Error Handling untuk Authentication dan Authorization

### 8.1 Authentication Error

Public response:

```json
{
  "code": "AUTH.INVALID_CREDENTIALS",
  "message": "Invalid credentials"
}
```

Internal security event:

```json
{
  "eventType": "AUTH_LOGIN_FAILED",
  "reason": "BAD_PASSWORD",
  "subjectHash": "...",
  "clientIpHash": "...",
  "userAgentHash": "...",
  "correlationId": "...",
  "riskSignals": ["KNOWN_DEVICE", "NORMAL_LOCATION"]
}
```

### 8.2 Authorization Error

Public response:

```json
{
  "code": "SECURITY.ACTION_NOT_ALLOWED",
  "message": "Action is not allowed"
}
```

Internal audit:

```json
{
  "eventType": "AUTHZ_DENIED",
  "subjectId": "USER-123",
  "resourceType": "CASE",
  "resourceId": "CASE-2026-0001",
  "action": "APPROVE_CASE",
  "policy": "case.approval.requires_assigned_approver",
  "decision": "DENY",
  "correlationId": "..."
}
```

### 8.3 Distinguishing 401 and 403

General model:

```text
401 Unauthorized:
  user/client belum authenticated atau credential/token invalid.

403 Forbidden:
  authenticated, tetapi tidak berhak.
```

Namun untuk sensitive resource, bisa gunakan 404 masking untuk mencegah enumeration.

### 8.4 Account Lock and MFA

Jangan terlalu informatif untuk unauthenticated attacker.

Boleh:

```text
Sign-in could not be completed. Follow the recovery instructions if this is your account.
```

Internal:

```text
ACCOUNT_LOCKED_DUE_TO_RISK_RULE
MFA_REQUIRED
MFA_CHALLENGE_FAILED
```

---

## 9. Error Handling untuk Validation yang Aman

Validation error berbeda dari internal exception. User butuh tahu input mana yang salah.

Namun validation detail tetap harus dibatasi.

Aman:

```json
{
  "code": "VALIDATION.FAILED",
  "fieldErrors": [
    {
      "field": "postalCode",
      "code": "INVALID_FORMAT",
      "message": "Postal code format is invalid"
    }
  ]
}
```

Tidak aman:

```json
{
  "field": "role",
  "message": "Role ADMIN_SUPERUSER_INTERNAL_ROOT is not allowed for this endpoint"
}
```

Tidak aman:

```json
{
  "field": "query",
  "message": "SQL syntax error near 'DROP TABLE user'"
}
```

Rule:

1. Field-level error boleh untuk input milik user.
2. Jangan tampilkan rule internal yang membuka policy/system design.
3. Jangan echo raw input berbahaya.
4. Batasi jumlah error.
5. Batasi panjang value.
6. Jangan return semua possible allowed values jika daftar itu sensitif.
7. Jangan validasi security-sensitive state dengan message terlalu detail.

---

## 10. Error Handling untuk Persistence yang Aman

Persistence layer sering bocor melalui exception message:

- SQL statement;
- constraint name;
- table name;
- column name;
- DB vendor error code;
- connection string;
- parameter value;
- deadlock graph;
- schema internal.

### 10.1 Unique Constraint

Internal exception:

```text
org.springframework.dao.DuplicateKeyException: duplicate key value violates unique constraint "uk_user_email"
```

External response:

```json
{
  "code": "USER.EMAIL_ALREADY_USED",
  "message": "Email cannot be used"
}
```

Namun untuk account enumeration sensitive flow, jangan return `EMAIL_ALREADY_USED` pada public registration jika itu membuka existence. Bisa gunakan:

```text
If this email can be used, you will receive further instructions.
```

### 10.2 Referential Constraint

Internal:

```text
foreign key constraint fk_case_application_id violated
```

External:

```json
{
  "code": "CASE.INVALID_REFERENCE",
  "message": "Referenced data is invalid or unavailable"
}
```

### 10.3 DB Down / Pool Exhaustion

External:

```json
{
  "code": "SYSTEM.TEMPORARILY_UNAVAILABLE",
  "message": "Service is temporarily unavailable",
  "retryable": true
}
```

Internal:

```text
DB_POOL_EXHAUSTED
DB_CONNECT_TIMEOUT
DB_STORAGE_PRESSURE
DB_LOCK_WAIT_TIMEOUT
```

Jangan return:

```text
Could not connect to jdbc:oracle:thin:@10.0.1.12:1521/PRODDB using user ACEAS_APP
```

---

## 11. Logging Security: Application Log vs Security Log vs Audit Log

### 11.1 Application Log

Tujuan:

- debugging;
- operation;
- incident analysis;
- performance investigation.

Contoh:

```json
{
  "level": "ERROR",
  "event": "EXTERNAL_DEPENDENCY_FAILED",
  "dependency": "onemap",
  "operation": "resolvePostalCode",
  "failureClass": "TIMEOUT",
  "durationMs": 3000,
  "correlationId": "01JZ..."
}
```

### 11.2 Security Log

Tujuan:

- detect abuse;
- intrusion investigation;
- auth/authz accountability;
- anomaly analysis.

Contoh:

```json
{
  "eventType": "AUTHZ_DENIED",
  "subjectId": "USER-123",
  "action": "CASE_APPROVE",
  "resourceId": "CASE-2026-001",
  "decision": "DENY",
  "reason": "NOT_ASSIGNED_APPROVER",
  "correlationId": "01JZ..."
}
```

### 11.3 Audit Log

Tujuan:

- legal/compliance evidence;
- reconstruct user/operator action;
- prove state transition;
- accountability.

Contoh:

```json
{
  "eventType": "CASE_APPROVAL_ATTEMPTED",
  "actorId": "USER-123",
  "actorType": "OFFICER",
  "caseId": "CASE-2026-001",
  "previousState": "PENDING_APPROVAL",
  "attemptedAction": "APPROVE",
  "result": "DENIED",
  "reasonCode": "AUTHZ_NOT_ASSIGNED_APPROVER",
  "occurredAt": "2026-06-16T10:15:30Z",
  "correlationId": "01JZ..."
}
```

### 11.4 Jangan Campur Semua

Anti-pattern:

```text
Satu log table dipakai untuk debug, audit, security, analytics, dan user activity.
```

Masalah:

- retention conflict;
- access control conflict;
- query volume conflict;
- PII exposure;
- evidence integrity lemah;
- noisy audit;
- audit log tidak defensible.

---

## 12. Redaction and Sanitization Strategy

### 12.1 Jangan Redact Terlambat

Buruk:

```java
log.info("request={}", requestBody);
```

lalu berharap log pipeline melakukan redaction.

Lebih baik:

```java
log.info("request received",
        kv("request_type", "SubmitApplication"),
        kv("payload_hash", hashCanonicalJson(requestBody)),
        kv("field_count", requestBody.fieldCount()),
        kv("correlation_id", correlationId));
```

### 12.2 Layer Redaction

Gunakan beberapa lapisan:

```text
Application-level redaction
  -> structured logging whitelist
  -> logging framework filter
  -> log collector redaction
  -> storage access control
  -> retention policy
```

Jangan mengandalkan satu lapisan.

### 12.3 Whitelist > Blacklist

Blacklist:

```text
redact password, token, secret
```

Masalah: field baru bisa lolos.

Whitelist:

```text
hanya field tertentu yang boleh masuk log
```

Lebih aman.

### 12.4 Example Redactor

```java
public final class SafeLogFields {
    private SafeLogFields() {}

    public static String maskEmail(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }

    public static String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        if (value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "...";
    }

    public static String removeControlCharacters(String value) {
        if (value == null) {
            return null;
        }
        return value.replaceAll("[\\r\\n\\t\\x00-\\x1F\\x7F]", "_");
    }
}
```

Catatan:

- ini contoh sederhana;
- production redaction harus diuji;
- jangan membuat regex redaction yang mudah bypass;
- jangan lupa nested JSON, arrays, headers, form-data, multipart, exception messages.

---

## 13. Stack Trace Policy

Stack trace berguna untuk engineer, tetapi berbahaya untuk client.

### 13.1 Client Response

Production:

```yaml
server:
  error:
    include-stacktrace: never
    include-message: never
    include-binding-errors: never
```

Catatan: properti Spring Boot dapat berbeda detail antar versi, tetapi prinsipnya sama: jangan expose stack trace/message internal di production error response.

### 13.2 Internal Logs

Tidak semua exception perlu stack trace.

| Failure | Stack Trace? | Reason |
|---|---:|---|
| expected validation | no | noise |
| expected auth denied | no | security event cukup |
| not found normal | no | noise |
| domain conflict expected | no/limited | known path |
| external timeout | maybe summary + sample | avoid log flood |
| unexpected bug | yes | debugging evidence |
| invariant violation | yes | severe |
| data corruption | yes + audit/security | severe |
| repeated same failure | sampled | avoid log storm |

### 13.3 Log Once Rule

Jangan log exception di setiap layer.

Buruk:

```text
Repository logs stack trace
Service logs stack trace
ControllerAdvice logs stack trace
Filter logs stack trace
APM logs stack trace
```

Hasil:

- duplicate noise;
- cost tinggi;
- sulit mencari root cause;
- potensi bocor lebih besar.

Rule:

> Translate di layer bawah, log di boundary yang punya context cukup, dan pastikan exception cause tetap preserved.

---

## 14. Error Response untuk Spring Boot yang Lebih Aman

Contoh `@RestControllerAdvice`:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(AuthenticationFailedException.class)
    ResponseEntity<ApiProblem> authenticationFailed(
            AuthenticationFailedException ex,
            HttpServletRequest request
    ) {
        String correlationId = Correlation.currentId();

        SecurityEvents.loginFailed(ex.reason(), ex.subjectFingerprint(), correlationId);

        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiProblem.of(
                        "https://api.example.gov/problems/authentication-failed",
                        "Authentication failed",
                        401,
                        "AUTH.INVALID_CREDENTIALS",
                        correlationId
                ));
    }

    @ExceptionHandler(AuthorizationDeniedException.class)
    ResponseEntity<ApiProblem> authorizationDenied(
            AuthorizationDeniedException ex,
            HttpServletRequest request
    ) {
        String correlationId = Correlation.currentId();

        SecurityEvents.authorizationDenied(
                ex.actorId(),
                ex.action(),
                ex.resourceType(),
                ex.resourceId(),
                ex.policyCode(),
                correlationId
        );

        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiProblem.of(
                        "https://api.example.gov/problems/action-not-allowed",
                        "Action is not allowed",
                        403,
                        "SECURITY.ACTION_NOT_ALLOWED",
                        correlationId
                ));
    }

    @ExceptionHandler(Throwable.class)
    ResponseEntity<ApiProblem> unexpected(Throwable ex) {
        String correlationId = Correlation.currentId();

        log.error("unexpected application failure correlationId={}", correlationId, ex);

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiProblem.of(
                        "https://api.example.gov/problems/internal-error",
                        "Request could not be processed",
                        500,
                        "SYSTEM.UNEXPECTED_ERROR",
                        correlationId
                ));
    }
}
```

Important:

- public message generic;
- internal reason preserved;
- security event separated;
- correlation id included;
- unexpected exception logged with stack trace;
- expected security failure not necessarily stack traced;
- no raw `ex.getMessage()` returned.

---

## 15. Audit Integrity During Failure

Audit log bukan sekadar “log aktivitas”. Untuk compliance system, audit log adalah evidence.

### 15.1 Audit Event Harus Mencatat Attempt, Bukan Hanya Success

Buruk:

```text
Only log APPROVED when approval succeeds.
```

Masalah:

- denied attempt hilang;
- malicious attempt tidak terlihat;
- authorization bug sulit ditemukan;
- audit tidak lengkap.

Lebih baik:

```text
CASE_APPROVAL_ATTEMPTED
CASE_APPROVAL_DENIED
CASE_APPROVAL_SUCCEEDED
CASE_APPROVAL_FAILED_SYSTEM_ERROR
```

atau satu event dengan result:

```json
{
  "eventType": "CASE_APPROVAL_ATTEMPT",
  "result": "DENIED",
  "reasonCode": "AUTHZ_NOT_ASSIGNED_APPROVER"
}
```

### 15.2 Audit Must Be Transactionally Meaningful

Jika business state berubah tetapi audit gagal, compliance risk tinggi.

Pilihan desain:

#### Option A — Same Transaction

```text
business table update + audit table insert dalam satu DB transaction
```

Kelebihan:

- atomic;
- sederhana;
- audit konsisten dengan data.

Kekurangan:

- audit write failure menggagalkan business operation;
- audit table pressure bisa mengganggu core transaction;
- high volume audit bisa bottleneck.

#### Option B — Transactional Outbox

```text
business update + audit_event_outbox insert dalam satu transaction
async publisher memindahkan ke audit store
```

Kelebihan:

- reliable handoff;
- cocok untuk async audit pipeline;
- retryable.

Kekurangan:

- audit store final mungkin eventual;
- butuh outbox monitor;
- butuh replay/idempotency.

#### Option C — Best Effort Async Log

```text
business update commit
try send audit event async
ignore failure
```

Ini biasanya tidak cukup untuk compliance-critical event.

### 15.3 Audit Failure Policy

Tentukan sejak desain:

| Audit Failure | Business Operation |
|---|---|
| Audit table unavailable untuk critical action | fail closed |
| Async audit publisher down tetapi outbox durable | allow, alert |
| Audit event serialization fails | fail action / quarantine |
| Audit storage full | fail closed atau emergency retention policy |
| Audit sink transient timeout | retry with backoff |
| Audit sink permanent schema error | stop pipeline, alert critical |

NIST SP 800-171 control family juga membahas response terhadap audit logging process failures, termasuk kondisi audit storage penuh dan mekanisme respons seperti menghentikan generation atau tindakan lain sesuai policy.

---

## 16. Tamper Resistance dan Evidence Preservation

Untuk system biasa, centralized log cukup. Untuk regulatory/compliance-heavy system, pertanyaan lebih keras:

1. Siapa yang bisa mengubah audit log?
2. Siapa yang bisa menghapus audit log?
3. Apakah admin DB bisa modify audit trail tanpa terdeteksi?
4. Apakah log punya immutable storage?
5. Apakah timestamp trusted?
6. Apakah event order bisa dibuktikan?
7. Apakah correlation chain utuh?
8. Apakah retention policy enforceable?
9. Apakah privileged access diaudit juga?
10. Apakah audit log failure diaudit?

### 16.1 Practical Controls

- append-only audit table;
- no update/delete permission untuk app user;
- separate schema/user untuk audit;
- database native audit untuk privileged operations;
- WORM/immutable object storage untuk archived logs;
- cryptographic hash chain untuk event sequence;
- signed audit batches;
- time synchronization via trusted source;
- separate access control for audit readers;
- audit access itself logged;
- retention and legal hold policy;
- monitoring for audit gap.

### 16.2 Hash Chain Example

Audit event:

```json
{
  "sequence": 1001,
  "previousHash": "abc...",
  "eventHash": "def...",
  "payload": {
    "eventType": "CASE_APPROVED",
    "caseId": "CASE-001",
    "actorId": "USER-123",
    "occurredAt": "2026-06-16T10:30:00Z"
  }
}
```

Hash:

```text
eventHash = SHA-256(canonicalJson(payload) + previousHash)
```

Jika event tengah diubah/dihapus, chain rusak.

Catatan:

- hash chain bukan solusi penuh;
- perlu key management jika pakai HMAC/signature;
- perlu storage immutability;
- perlu process control.

---

## 17. Compliance-Oriented Error Classification

Dalam sistem regulatory, error tidak cukup diklasifikasikan secara teknis.

Tambahkan dimensi compliance:

```text
Error classification:
  - user-correctable
  - business-correctable
  - operator-correctable
  - developer-correctable
  - security-relevant
  - audit-relevant
  - compliance-impacting
  - data-integrity-impacting
  - privacy-impacting
```

Contoh:

| Error | Security Relevant | Audit Relevant | Compliance Impact | Response |
|---|---:|---:|---:|---|
| Invalid email format | no | no | low | 400 validation |
| Login failed | yes | yes | medium | 401 generic + security event |
| Unauthorized approval attempt | yes | yes | high | 403/404 + audit |
| Audit insert failed | yes | yes | high | fail closed / critical alert |
| PII redaction failed | yes | yes | high | stop processing / quarantine |
| Case state invariant broken | maybe | yes | high | block action + incident |
| DB timeout on read | no/maybe | no | medium | 503/retryable |
| Duplicate submission | no | yes | medium | idempotency response |
| Malware scanner unavailable | yes | yes | high | pending/fail closed |

---

## 18. Privacy-Aware Error Handling

### 18.1 Data Minimization

Jangan mencatat data karena “mungkin nanti berguna”.

Pertanyaan sebelum log field:

1. Untuk investigasi apa field ini diperlukan?
2. Siapa yang boleh melihatnya?
3. Berapa lama perlu disimpan?
4. Apakah bisa diganti hash/mask?
5. Apakah field ini bisa mengidentifikasi individu?
6. Apakah field ini sensitif secara hukum/regulasi?
7. Apakah field ini bisa muncul di alert/email/chat?
8. Apakah field ini ikut ke vendor observability?

### 18.2 Purpose Limitation

Audit log untuk compliance jangan otomatis dipakai untuk analytics bebas.

Application log untuk debugging jangan berisi data user lengkap.

Security log untuk abuse detection jangan dibuka ke semua developer.

### 18.3 Retention

Error evidence punya retention berbeda:

| Data | Typical Retention Consideration |
|---|---|
| debug application log | pendek-menengah |
| security event | menengah-panjang |
| audit trail | sesuai regulasi/kontrak |
| trace sampling | pendek |
| raw request payload | hindari; jika perlu sangat pendek dan restricted |
| PII in log | minimalkan; retention ketat |
| incident evidence | legal hold mungkin diperlukan |

---

## 19. Security-Aware Observability

Observability bisa menjadi data exfiltration path.

### 19.1 Metrics

Jangan jadikan PII sebagai label/tag.

Buruk:

```text
login_failure_total{email="alice@example.com", reason="BAD_PASSWORD"}
```

Masalah:

- high cardinality;
- PII leak;
- expensive;
- hard to delete.

Baik:

```text
login_failure_total{reason="BAD_PASSWORD"}
```

Jika butuh user-level investigation, gunakan security log restricted, bukan metric label.

### 19.2 Traces

Jangan masukkan:

- raw request body;
- token;
- cookie;
- password;
- PII;
- document content;
- SQL with bind values.

Masukkan:

- correlation id;
- operation name;
- dependency name;
- sanitized error code;
- failure class;
- retry attempt count;
- timeout budget consumed.

### 19.3 Alerts

Alert dikirim ke email/chat/on-call tools. Jangan masukkan sensitive payload.

Buruk:

```text
Login failed for user alice@example.com with password abc123
```

Baik:

```text
High login failure rate detected for tenant=public, reason=BAD_PASSWORD, window=5m
```

---

## 20. Safe Error Handling for External Integrations

External provider response kadang mengandung data sensitif.

Contoh:

```json
{
  "error": "invalid_request",
  "error_description": "NRIC S1234567A not found for user fajar@example.com"
}
```

Jangan pass-through ke client/log mentah.

### 20.1 Provider Error Normalization

```java
public ExternalFailure normalizeProviderError(HttpStatusCode status, String body) {
    ProviderError parsed = safeParse(body);

    return switch (status.value()) {
        case 400 -> ExternalFailure.nonRetryable("PROVIDER.BAD_REQUEST");
        case 401 -> ExternalFailure.authFailure("PROVIDER.AUTH_FAILED");
        case 403 -> ExternalFailure.authFailure("PROVIDER.FORBIDDEN");
        case 429 -> ExternalFailure.retryable("PROVIDER.RATE_LIMITED");
        case 500, 502, 503, 504 -> ExternalFailure.retryable("PROVIDER.UNAVAILABLE");
        default -> ExternalFailure.unknown("PROVIDER.UNKNOWN_FAILURE");
    };
}
```

### 20.2 Log Sanitized Provider Evidence

```java
log.warn("provider request failed",
        kv("provider", "myinfo"),
        kv("operation", "fetchProfile"),
        kv("http_status", status.value()),
        kv("provider_error_code", safeProviderCode(parsed.code())),
        kv("correlation_id", correlationId));
```

Do not log full provider body unless explicitly allowed, redacted, access-controlled, and necessary.

---

## 21. Secure Exception Hierarchy

Exception hierarchy bisa membantu menjaga security semantics.

```java
public sealed class ApplicationException extends RuntimeException
        permits ClientVisibleException, InternalOnlyException {

    private final String internalCode;
    private final boolean securityRelevant;
    private final boolean auditRelevant;

    protected ApplicationException(
            String internalCode,
            String message,
            Throwable cause,
            boolean securityRelevant,
            boolean auditRelevant
    ) {
        super(message, cause);
        this.internalCode = internalCode;
        this.securityRelevant = securityRelevant;
        this.auditRelevant = auditRelevant;
    }

    public String internalCode() {
        return internalCode;
    }

    public boolean securityRelevant() {
        return securityRelevant;
    }

    public boolean auditRelevant() {
        return auditRelevant;
    }
}
```

Client-visible exception:

```java
public final class ClientVisibleException extends ApplicationException {
    private final String publicCode;
    private final int httpStatus;

    public ClientVisibleException(
            String publicCode,
            String internalCode,
            int httpStatus,
            String safeMessage
    ) {
        super(internalCode, safeMessage, null, false, false);
        this.publicCode = publicCode;
        this.httpStatus = httpStatus;
    }

    public String publicCode() {
        return publicCode;
    }

    public int httpStatus() {
        return httpStatus;
    }
}
```

Security exception:

```java
public final class AuthorizationDeniedException extends ApplicationException {
    private final String actorId;
    private final String action;
    private final String resourceType;
    private final String resourceId;
    private final String policyCode;

    public AuthorizationDeniedException(
            String actorId,
            String action,
            String resourceType,
            String resourceId,
            String policyCode
    ) {
        super("AUTHZ_DENIED", "Authorization denied", null, true, true);
        this.actorId = actorId;
        this.action = action;
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        this.policyCode = policyCode;
    }

    // getters
}
```

Principle:

- exception can carry internal context;
- handler decides what becomes public;
- public response never blindly uses exception message;
- security/audit flags guide logging and event emission.

---

## 22. Error Code Governance

Error code harus dikelola seperti API contract.

### 22.1 Public Code

Contoh:

```text
VALIDATION.FAILED
AUTH.INVALID_CREDENTIALS
SECURITY.ACTION_NOT_ALLOWED
CASE.INVALID_STATE
CASE.CONFLICT
SYSTEM.TEMPORARILY_UNAVAILABLE
SYSTEM.UNEXPECTED_ERROR
```

Public code harus:

- stable;
- documented;
- not overly granular;
- tidak expose implementation;
- berguna untuk client behavior;
- backward compatible.

### 22.2 Internal Code

Contoh:

```text
AUTHZ_POLICY_DENIED_NOT_ASSIGNED_APPROVER
AUTHZ_POLICY_ENGINE_TIMEOUT
CASE_STATE_TRANSITION_GUARD_FAILED
DB_UNIQUE_CONSTRAINT_CASE_REFERENCE
AUDIT_OUTBOX_INSERT_FAILED
TOKEN_REFRESH_PROVIDER_401
```

Internal code boleh lebih detail, tetapi tetap jangan mengandung data sensitif.

### 22.3 Mapping

```text
Internal Code                               Public Code
---------------------------------------------------------------
AUTHZ_POLICY_DENIED_NOT_ASSIGNED_APPROVER   SECURITY.ACTION_NOT_ALLOWED
AUTHZ_POLICY_DENIED_ROLE_MISSING            SECURITY.ACTION_NOT_ALLOWED
AUTHZ_POLICY_ENGINE_TIMEOUT                 SYSTEM.TEMPORARILY_UNAVAILABLE
DB_UNIQUE_CONSTRAINT_CASE_REFERENCE         CASE.CONFLICT
AUDIT_OUTBOX_INSERT_FAILED                  SYSTEM.UNEXPECTED_ERROR
TOKEN_REFRESH_PROVIDER_401                  SYSTEM.TEMPORARILY_UNAVAILABLE
```

---

## 23. Security Error Anti-Patterns

### 23.1 Returning Raw Exception Message

```java
return ResponseEntity.internalServerError().body(ex.getMessage());
```

Fatal karena message internal tidak aman.

### 23.2 Stack Trace in Production Response

```json
{
  "trace": "com.example.case.CaseService.approve(CaseService.java:121)..."
}
```

Expose internals.

### 23.3 Catch and Allow

```java
catch (AuthorizationException e) {
    return true;
}
```

Authorization bypass.

### 23.4 Catch and Hide Security Failure

```java
catch (Exception e) {
    return Optional.empty();
}
```

Jika ini menyembunyikan policy failure atau data integrity issue, evidence hilang.

### 23.5 Logging Full Request

```java
log.info("request={}", requestBody);
```

PII/token leak.

### 23.6 Logging Authorization Header

```java
log.info("headers={}", request.getHeaders());
```

Token leak.

### 23.7 Different Login Error Messages

```text
Email not registered
Password incorrect
```

Enumeration.

### 23.8 Audit Only on Success

Denied/malicious attempts hilang.

### 23.9 Best-Effort Audit for Critical Operations

Compliance evidence tidak reliable.

### 23.10 Sensitive Data in Metric Labels

```text
error_total{userId="...", email="..."}
```

PII + cardinality explosion.

### 23.11 Overly Helpful Security Error Code

```text
AUTH.USER_EXISTS_BUT_PASSWORD_EXPIRED_AND_MFA_ENABLED
```

Enumeration + targeted attack.

### 23.12 Swallowing Redaction Failure

Jika redactor gagal, jangan fallback ke raw payload.

### 23.13 Debug Endpoint Exposes Last Error

Endpoint debug/support yang menampilkan raw exception sering menjadi backdoor leakage.

---

## 24. Production Checklist

### 24.1 Client Error Response

- [ ] Tidak ada stack trace di production response.
- [ ] Tidak ada exception class/package di response.
- [ ] Tidak ada SQL/table/schema/path internal di response.
- [ ] Error code stable dan documented.
- [ ] Auth error tidak membuka user enumeration.
- [ ] Authorization error tidak menjadi resource existence oracle jika resource sensitif.
- [ ] Correlation id tersedia dan aman.
- [ ] Validation field error tidak echo raw dangerous input.
- [ ] `5xx` message generic.
- [ ] `4xx` message cukup actionable tetapi aman.

### 24.2 Logging

- [ ] Tidak log password/token/secret/cookie/authorization header.
- [ ] Tidak log full request/response body by default.
- [ ] Structured logging digunakan.
- [ ] Control characters disanitasi.
- [ ] PII masked/hashed/truncated.
- [ ] Log access restricted.
- [ ] Log retention defined.
- [ ] Log transport encrypted.
- [ ] Log storage access audited.
- [ ] Error log tidak duplicate di banyak layer.

### 24.3 Audit

- [ ] Critical action audit ditulis untuk success dan failure/denied attempts.
- [ ] Audit event punya actor/action/resource/result/time/correlation.
- [ ] Audit failure policy jelas.
- [ ] Audit write durable.
- [ ] Audit log protected dari update/delete tidak sah.
- [ ] Privileged access ke audit log diaudit.
- [ ] Retention sesuai policy/regulation.
- [ ] Audit event schema versioned.
- [ ] Audit gap monitored.

### 24.4 Security Decisions

- [ ] Authentication provider failure tidak menyebabkan allow.
- [ ] Authorization provider failure tidak menyebabkan allow.
- [ ] Token verification failure tidak bypass validation.
- [ ] JWKS/key cache punya bounded safe behavior.
- [ ] Malware scan unavailable tidak mark file safe.
- [ ] Encryption failure tidak fallback ke plaintext.
- [ ] Audit failure untuk critical operation tidak ignored.

### 24.5 Observability

- [ ] Metric labels tidak berisi PII/high-cardinality user identifiers.
- [ ] Trace attributes tidak berisi token/body/PII.
- [ ] Alerts tidak membawa sensitive payload.
- [ ] Security events punya severity/risk classification.
- [ ] Incident evidence cukup tanpa membuka data sensitif.

### 24.6 Testing

- [ ] Test production error response tidak mengandung stack trace.
- [ ] Test login tidak membedakan user-not-found/password-wrong.
- [ ] Test authorization failure tidak leak resource existence jika masking policy berlaku.
- [ ] Test log redaction untuk password/token/header/body.
- [ ] Test audit event emitted for denied attempt.
- [ ] Test audit failure behavior.
- [ ] Test provider error body tidak pass-through.
- [ ] Test validation does not echo malicious input.
- [ ] Test metrics/traces do not include sensitive labels.

---

## 25. Testing Examples

### 25.1 Ensure No Stack Trace in Response

```java
@Test
void unexpectedErrorShouldNotExposeStackTrace() throws Exception {
    mockMvc.perform(get("/api/test/unexpected-error"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value("SYSTEM.UNEXPECTED_ERROR"))
            .andExpect(jsonPath("$.correlationId").exists())
            .andExpect(jsonPath("$.trace").doesNotExist())
            .andExpect(jsonPath("$.exception").doesNotExist())
            .andExpect(jsonPath("$.message").value("Request could not be processed"));
}
```

### 25.2 Ensure Login Response Does Not Enumerate

```java
@Test
void loginFailureShouldNotRevealWhetherUserExists() throws Exception {
    mockMvc.perform(post("/api/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"username":"unknown@example.com","password":"bad"}
                            """))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("AUTH.INVALID_CREDENTIALS"));

    mockMvc.perform(post("/api/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"username":"known@example.com","password":"bad"}
                            """))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("AUTH.INVALID_CREDENTIALS"));
}
```

### 25.3 Ensure Provider Error Not Passed Through

```java
@Test
void providerErrorShouldBeSanitized() throws Exception {
    provider.stubError(500, "NRIC S1234567A failed for user secret@example.com");

    mockMvc.perform(get("/api/profile"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.code").value("SYSTEM.TEMPORARILY_UNAVAILABLE"))
            .andExpect(content().string(not(containsString("S1234567A"))))
            .andExpect(content().string(not(containsString("secret@example.com"))));
}
```

### 25.4 Ensure Audit on Denied Action

```java
@Test
void deniedApprovalShouldCreateAuditEvent() {
    assertThrows(AuthorizationDeniedException.class, () -> {
        caseService.approve(caseId, actorWithoutApprovalRole);
    });

    AuditEvent event = auditRepository.findLatestByCorrelationId(Correlation.currentId());

    assertThat(event.eventType()).isEqualTo("CASE_APPROVAL_ATTEMPT");
    assertThat(event.result()).isEqualTo("DENIED");
    assertThat(event.reasonCode()).isEqualTo("AUTHZ_NOT_ASSIGNED_APPROVER");
}
```

---

## 26. Case Study: Approval Operation in Regulatory System

Misal ada operasi:

```text
POST /cases/{caseId}/approve
```

Risiko:

- user tidak authorized;
- case tidak ada;
- case ada tapi user tidak boleh tahu;
- case state tidak valid;
- audit gagal;
- DB commit berhasil tetapi response gagal;
- notification gagal;
- PII dalam rejection reason bocor ke log;
- repeated failed attempts menunjukkan malicious behavior.

### 26.1 Desired External Behavior

| Condition | Response |
|---|---|
| not authenticated | 401 generic |
| not authorized, resource existence sensitive | 404 or 403 generic depending policy |
| invalid state | 409 with safe code |
| validation failure | 400 field errors |
| audit unavailable | 503 or 500 generic |
| DB timeout | 503 retryable if safe |
| success | 200/204 |

### 26.2 Internal Evidence

Untuk setiap attempt:

```json
{
  "eventType": "CASE_APPROVAL_ATTEMPT",
  "actorId": "USER-123",
  "caseId": "CASE-2026-001",
  "action": "APPROVE",
  "result": "DENIED",
  "reasonCode": "AUTHZ_NOT_ASSIGNED_APPROVER",
  "correlationId": "01JZ...",
  "occurredAt": "2026-06-16T10:45:00Z"
}
```

Untuk success:

```json
{
  "eventType": "CASE_STATE_CHANGED",
  "actorId": "USER-456",
  "caseId": "CASE-2026-001",
  "fromState": "PENDING_APPROVAL",
  "toState": "APPROVED",
  "reasonCode": "APPROVED_BY_AUTHORIZED_OFFICER",
  "correlationId": "01JZ..."
}
```

### 26.3 Transaction Design

```text
BEGIN TRANSACTION
  load case with lock/version
  authorize actor
  validate state transition
  update case state
  insert audit event / outbox
COMMIT

AFTER COMMIT
  publish notification command
  update search index asynchronously
```

Jika audit insert gagal:

```text
ROLLBACK business state update
return generic failure
alert if repeated
```

Jika notification gagal setelah commit:

```text
business state remains approved
notification retried via outbox
no rollback approval
```

Security/compliance distinction:

- audit is part of defensible state change;
- notification is side effect and can be retried.

---

## 27. Design Principles

### Principle 1 — Public Errors Are Not Debug Channels

Client response bukan tempat debugging internal.

### Principle 2 — Internal Evidence Must Be Rich but Protected

Jangan membocorkan ke client, tetapi jangan juga menghapus evidence internal.

### Principle 3 — Security Decisions Must Fail Closed

Jika tidak bisa verify, jangan allow.

### Principle 4 — Audit Is a Product Feature, Not Logging Side Effect

Audit harus didesain dengan schema, lifecycle, ownership, access control, dan failure policy.

### Principle 5 — Error Semantics Must Separate Public and Internal Codes

Public code stabil dan aman; internal code detail dan restricted.

### Principle 6 — Redaction Must Be Tested

Redaction bukan asumsi. Harus punya test.

### Principle 7 — Sensitive Data Should Be Whitelisted, Not Blacklisted

Yang boleh keluar harus eksplisit.

### Principle 8 — Compliance Failure Is Not Ordinary Technical Failure

Audit failure, privacy leakage, policy bypass, dan data integrity breach harus punya severity sendiri.

### Principle 9 — Observability Must Not Become Exfiltration

Metrics, traces, logs, alerts, dan dashboards adalah data surfaces.

### Principle 10 — Error Handling Should Support Forensics

Setelah incident, sistem harus bisa menjawab:

- siapa melakukan apa;
- kapan;
- dari mana;
- terhadap resource apa;
- hasilnya apa;
- policy apa yang dipakai;
- error apa yang terjadi;
- data/state apa yang berubah;
- evidence mana yang reliable.

---

## 28. Review Questions

1. Apa bedanya client-facing error dan internal evidence?
2. Mengapa `ex.getMessage()` tidak boleh langsung dikirim ke response?
3. Mengapa login failure sebaiknya tidak membedakan user-not-found dan wrong-password?
4. Kapan authorization failure sebaiknya dimasking sebagai 404?
5. Mengapa authorization service failure tidak boleh fallback ke allow?
6. Apa beda application log, security log, dan audit log?
7. Mengapa audit harus mencatat failed/denied attempts?
8. Apa konsekuensi jika audit write gagal setelah business update berhasil?
9. Mengapa metric label tidak boleh berisi email/user id?
10. Bagaimana cara menguji bahwa error response tidak membocorkan stack trace?
11. Apa yang harus dilakukan jika external provider error body mengandung PII?
12. Mengapa redaction berbasis blacklist lebih lemah daripada whitelist?
13. Apa saja contoh compliance-impacting error?
14. Mengapa debug-level observability bisa menjadi data exfiltration path?
15. Apa arti fail-closed dalam token validation?

---

## 29. Ringkasan

Error handling yang aman dan compliant tidak berhenti pada `try-catch`. Ia harus menjawab empat kebutuhan sekaligus:

```text
1. Client mendapat response yang stabil, aman, dan cukup actionable.
2. Operator mendapat evidence yang cukup untuk investigasi.
3. Security team mendapat signal untuk abuse dan policy violation.
4. Auditor mendapat trail yang defensible, lengkap, dan protected.
```

Kesalahan paling umum adalah mencampur semua kebutuhan itu ke satu channel: response atau log mentah.

Desain yang matang memisahkan:

```text
External response:
  minimal, stable, safe

Internal log:
  diagnostic, structured, redacted

Security event:
  abuse/security relevant

Audit event:
  accountability and compliance evidence

Metrics/traces:
  aggregate health and causality without sensitive payload
```

Mental model terpenting:

> Error handling adalah bagian dari security boundary dan compliance evidence chain. Sistem yang reliable tetapi membocorkan data, bypass authorization saat dependency gagal, atau kehilangan audit trail tetap bukan sistem yang layak produksi.

---

## 30. Status Seri

```text
Part 025 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 026 — Testing Failure and Shutdown Behavior
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 024 — Incident-Oriented Error Handling](./learn-java-reliability-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 026 — Testing Failure and Shutdown Behavior](./learn-java-reliability-part-026.md)
