# learn-http-for-web-backend-perspective-part-010.md

# Part 010 — Error Response Design and Problem Details

> Seri: `learn-http-for-web-backend-perspective`  
> Part: `010 / 032`  
> Fokus: mendesain error response backend HTTP yang benar secara semantik, stabil sebagai kontrak API, aman dari kebocoran internal, mudah diobservasi, dan cukup kaya untuk dipakai client secara deterministik.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **exception internal**, **domain error**, **validation error**, **authorization error**, **transport/protocol error**, dan **dependency failure**.
2. Mendesain error response sebagai **API contract**, bukan output kebetulan dari framework.
3. Menggunakan pendekatan **Problem Details** modern berdasarkan RFC 9457.
4. Memilih status code, error code, message, dan metadata dengan konsisten.
5. Membuat error response yang aman: tidak membocorkan stack trace, SQL detail, token, internal host, class name, rule rahasia, atau data sensitif.
6. Mendesain error response yang bisa dipakai oleh:
   - manusia,
   - frontend,
   - mobile app,
   - service-to-service client,
   - batch worker,
   - monitoring system,
   - audit/compliance system.
7. Memetakan exception Java/Spring ke HTTP response secara eksplisit.
8. Mendesain taxonomy error untuk sistem besar dan workflow-heavy.
9. Menghindari anti-pattern seperti `200 OK` untuk error, error code acak, response shape berubah-ubah, dan pesan internal bocor.
10. Menghubungkan error response dengan observability, tracing, support, incident response, dan regulatory defensibility.

---

## 1. Mental Model: Error Adalah Kontrak, Bukan Kecelakaan

Banyak backend API memperlakukan error sebagai sisa dari implementasi:

```json
{
  "timestamp": "2026-06-18T10:15:30.123+00:00",
  "status": 500,
  "error": "Internal Server Error",
  "trace": "java.lang.NullPointerException...",
  "path": "/api/cases/123"
}
```

Atau lebih buruk:

```json
{
  "success": false,
  "message": "Something went wrong"
}
```

Masalahnya bukan hanya estetika. Error response adalah bagian dari kontrak API. Client akan membuat keputusan berdasarkan error:

- apakah request boleh diulang?
- apakah user perlu memperbaiki input?
- apakah user tidak punya izin?
- apakah resource tidak ada?
- apakah konflik state perlu diselesaikan?
- apakah operasi masih diproses?
- apakah sistem sedang overload?
- apakah ada bug server?
- apakah error perlu dicatat sebagai audit event?

Backend top-tier tidak mendesain error response setelah semua controller selesai. Backend top-tier mendesain error response sebagai **state contract**.

### 1.1 Error response berada di antara tiga dunia

Error response adalah titik temu antara:

```text
Internal world
  exception, domain rule, persistence error, dependency error
       |
       v
HTTP/API contract world
  status, headers, media type, problem type, code, correlation id
       |
       v
Consumer world
  user message, retry decision, UI field marker, automation, support ticket
```

Kesalahan umum adalah membiarkan detail dari satu dunia bocor ke dunia lain.

Contoh:

- Internal exception bocor ke client: `NullPointerException`, `ConstraintViolationException`, SQL syntax, stack trace.
- UI wording dijadikan stable machine code: `"Email is already used"` lalu client membandingkan string.
- HTTP status diabaikan dan semua hal dikirim sebagai `200 OK`.
- Domain error disamakan dengan server error.
- Dependency timeout dikirim sebagai `400 Bad Request`.
- Authorization failure menjelaskan terlalu detail kenapa access ditolak.

### 1.2 Prinsip utama

Error response backend yang baik harus memenuhi tujuh sifat:

| Sifat | Makna |
|---|---|
| Semantically correct | HTTP status sesuai jenis kegagalan. |
| Stable | Client bisa bergantung pada shape dan code. |
| Machine-readable | Client tidak perlu parsing free-text message. |
| Human-usable | Ada title/detail yang cukup jelas untuk developer/support. |
| Safe | Tidak bocor internal/sensitive data. |
| Observable | Bisa dikorelasikan dengan log, metrics, trace. |
| Evolvable | Bisa ditambah field/code tanpa merusak client lama. |

---

## 2. Error Bukan Selalu Exception

Dalam Java backend, developer sering menyamakan error response dengan exception handling. Padahal error response bisa berasal dari banyak kategori.

```text
Incoming request
   |
   +-- protocol/parsing error
   +-- media type error
   +-- authentication error
   +-- authorization error
   +-- validation error
   +-- domain rule rejection
   +-- state conflict
   +-- concurrency conflict
   +-- dependency failure
   +-- timeout/cancellation
   +-- server bug
```

Exception hanyalah salah satu mekanisme implementasi. Error contract seharusnya tidak mengikuti class exception secara mentah.

### 2.1 Exception internal

Contoh:

```java
throw new NullPointerException();
throw new SQLException("relation case_table does not exist");
throw new IllegalStateException("impossible state");
```

Ini umumnya bukan domain contract. Untuk client, ini biasanya menjadi:

```http
500 Internal Server Error
```

Dengan body generik:

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "The server encountered an unexpected condition.",
  "instance": "/cases/CASE-123/transitions",
  "code": "INTERNAL_ERROR",
  "correlationId": "01JZ..."
}
```

Log internal boleh punya stack trace. Response external tidak.

### 2.2 Domain rejection

Contoh:

```text
Case cannot be approved because mandatory evidence review is incomplete.
```

Ini bukan bug. Ini domain rule bekerja dengan benar. Status bisa `409 Conflict`, `422 Unprocessable Content`, atau `403 Forbidden`, tergantung sifat rule.

Error contract bisa seperti:

```json
{
  "type": "https://api.example.com/problems/case-transition-not-allowed",
  "title": "Case transition is not allowed",
  "status": 409,
  "detail": "The case cannot transition from UNDER_REVIEW to APPROVED because required evidence review is incomplete.",
  "code": "CASE_TRANSITION_NOT_ALLOWED",
  "currentState": "UNDER_REVIEW",
  "requestedTransition": "APPROVE",
  "requiredAction": "COMPLETE_EVIDENCE_REVIEW",
  "correlationId": "01JZ..."
}
```

### 2.3 Validation error

Contoh:

```text
field `dueDate` must be in the future
field `respondent.email` must be a valid email address
```

Ini biasanya `400 Bad Request` atau `422 Unprocessable Content`, bergantung pada boundary model yang dipilih. Detailnya perlu field-level errors.

### 2.4 Authentication error

Contoh:

```text
missing token
expired token
invalid signature
wrong issuer
```

Umumnya `401 Unauthorized` dan response perlu mempertimbangkan header `WWW-Authenticate`, terutama untuk skema HTTP authentication.

### 2.5 Authorization error

Contoh:

```text
user is authenticated but lacks permission to approve this case
```

Umumnya `403 Forbidden`, tetapi untuk resource hiding bisa sengaja dikembalikan sebagai `404 Not Found`.

### 2.6 Conflict/concurrency error

Contoh:

```text
client updates case version 7, but server has version 8
```

Biasanya `409 Conflict` atau `412 Precondition Failed` jika menggunakan conditional request seperti `If-Match`.

### 2.7 Dependency failure

Contoh:

```text
identity service timeout
evidence storage unavailable
payment gateway returned 503
```

Client tidak selalu perlu tahu dependency mana yang gagal. Status bisa `502 Bad Gateway`, `503 Service Unavailable`, atau `504 Gateway Timeout`, tergantung posisi service sebagai gateway/upstream caller dan sifat kegagalan.

---

## 3. Problem Details: Standard Shape untuk Error HTTP API

RFC 9457 mendefinisikan format **Problem Details for HTTP APIs**. Tujuannya adalah membawa detail error secara machine-readable tanpa setiap API menciptakan format baru dari nol. RFC 9457 juga menggantikan RFC 7807.

Media type utamanya:

```http
Content-Type: application/problem+json
```

atau untuk XML:

```http
Content-Type: application/problem+xml
```

Bentuk JSON dasarnya:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more request fields are invalid.",
  "instance": "/cases"
}
```

### 3.1 Lima member standar

| Field | Makna | Stabilitas |
|---|---|---|
| `type` | URI identifier untuk problem type. | Harus stabil. |
| `title` | Ringkasan singkat problem type. | Relatif stabil. |
| `status` | HTTP status code. | Harus sesuai response status. |
| `detail` | Penjelasan instance spesifik. | Bisa berubah, jangan diparse client. |
| `instance` | URI yang mengidentifikasi problem occurrence atau request target. | Berguna untuk support/debugging. |

### 3.2 Extension members

Problem Details mengizinkan field tambahan. Inilah tempat kita menambahkan metadata domain/API.

Contoh:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more request fields are invalid.",
  "instance": "/cases",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZ8E3D9J3T9M6X6WV7V12FZ9",
  "errors": [
    {
      "field": "respondent.email",
      "code": "EMAIL_INVALID",
      "message": "must be a valid email address"
    },
    {
      "field": "dueDate",
      "code": "DATE_MUST_BE_FUTURE",
      "message": "must be in the future"
    }
  ]
}
```

### 3.3 `type` bukan sekadar dokumentasi

`type` adalah identifier problem category. Ia bisa berupa URL yang bisa dibuka manusia, tetapi yang penting adalah stabil sebagai identifier.

Contoh baik:

```text
https://api.example.com/problems/validation-error
https://api.example.com/problems/case-transition-not-allowed
https://api.example.com/problems/idempotency-key-conflict
https://api.example.com/problems/resource-version-conflict
```

Contoh buruk:

```text
/error
/problem
https://api.example.com/errors/123456-random
java.lang.IllegalArgumentException
```

### 3.4 `title` bukan tempat detail instance

Baik:

```json
{
  "title": "Validation failed",
  "detail": "Field `dueDate` must be in the future."
}
```

Buruk:

```json
{
  "title": "dueDate 2025-01-01 is not valid for case CASE-123 because today is 2026-06-18 and policy rule XYZ failed"
}
```

`title` harus ringkas dan cenderung stabil. `detail` boleh lebih instance-specific.

### 3.5 `status` harus cocok dengan HTTP status line

Buruk:

```http
HTTP/1.1 200 OK
Content-Type: application/problem+json

{
  "status": 422,
  "title": "Validation failed"
}
```

Buruk juga:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "status": 400,
  "title": "Validation failed"
}
```

Baik:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "status": 422,
  "title": "Validation failed"
}
```

Jika body dan status line konflik, client, gateway, log, metric, dan monitoring akan memiliki interpretasi berbeda.

---

## 4. Error Taxonomy: Fondasi Sistem Besar

Untuk sistem kecil, beberapa error code mungkin cukup. Untuk sistem besar, kamu perlu taxonomy.

### 4.1 Level taxonomy

```text
HTTP status category
  -> problem type
     -> stable application code
        -> optional field/sub-error code
```

Contoh:

```text
4xx client-side/request/domain category
  -> validation-error
     -> VALIDATION_FAILED
        -> EMAIL_INVALID
        -> REQUIRED_FIELD_MISSING
        -> DATE_MUST_BE_FUTURE

4xx conflict category
  -> case-transition-not-allowed
     -> CASE_TRANSITION_NOT_ALLOWED
        -> EVIDENCE_REVIEW_INCOMPLETE
        -> CASE_ALREADY_CLOSED
        -> SUPERVISOR_APPROVAL_REQUIRED

5xx server/dependency category
  -> upstream-timeout
     -> UPSTREAM_TIMEOUT
        -> IDENTITY_SERVICE_TIMEOUT
        -> EVIDENCE_STORAGE_TIMEOUT
```

Namun hati-hati: semakin spesifik error response, semakin besar risiko:

- bocor internal topology,
- client menjadi terlalu coupled,
- code sulit dievolusi,
- attacker mendapat oracle.

### 4.2 Layered error classification

| Layer | Contoh | Exposed ke client? |
|---|---|---|
| Protocol | malformed HTTP, unsupported media type | Ya, sebagai status/standard problem. |
| Parsing | invalid JSON syntax | Ya, generik. |
| Structural validation | missing field, invalid type | Ya, field-level. |
| Semantic validation | date range invalid, invalid transition request | Ya, biasanya. |
| Authorization | forbidden action | Ya, tetapi detail dibatasi. |
| Domain invariant | case already closed | Ya, jika aman dan bagian kontrak. |
| Persistence | unique constraint, deadlock | Dipetakan, detail DB tidak bocor. |
| Dependency | timeout, unavailable | Biasanya generik. |
| Bug | NPE, assertion failure | Tidak, hanya generic 500. |

### 4.3 Stable code vs message

Client boleh bergantung pada:

- HTTP status,
- `type`,
- `code`,
- field error `code`,
- documented extension fields.

Client tidak boleh bergantung pada:

- `detail` wording,
- localized message,
- order of fields,
- stack trace,
- framework exception class,
- database constraint name.

Desain yang baik:

```json
{
  "code": "CASE_TRANSITION_NOT_ALLOWED",
  "detail": "The case cannot be approved in its current state."
}
```

Desain buruk:

```json
{
  "code": "The case cannot be approved in its current state."
}
```

---

## 5. Status Code dan Error Response: Mapping Praktis

Part 004 sudah membahas status code. Di sini kita fokus pada hubungan status code dengan error body.

### 5.1 400 Bad Request

Gunakan untuk request yang secara umum invalid di level syntax, parsing, atau request construction.

Contoh:

- malformed JSON,
- invalid query parameter format,
- invalid path variable format,
- required header missing,
- unsupported parameter combination jika dianggap request construction invalid.

Example:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/malformed-request",
  "title": "Malformed request",
  "status": 400,
  "detail": "The request body contains invalid JSON.",
  "code": "MALFORMED_REQUEST",
  "correlationId": "01JZ..."
}
```

### 5.2 401 Unauthorized

Gunakan ketika authentication diperlukan atau gagal.

Contoh:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api", error="invalid_token"
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "detail": "A valid access token is required to access this resource.",
  "code": "AUTHENTICATION_REQUIRED",
  "correlationId": "01JZ..."
}
```

Jangan tulis:

```json
{
  "detail": "JWT signature failed using secret key from env var CASE_API_JWT_SECRET"
}
```

### 5.3 403 Forbidden

Gunakan ketika identity diketahui tetapi tidak punya izin.

```json
{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to perform this action.",
  "code": "FORBIDDEN",
  "correlationId": "01JZ..."
}
```

Untuk resource yang perlu disembunyikan, kamu bisa gunakan `404 Not Found` agar tidak menjadi oracle.

### 5.4 404 Not Found

Gunakan ketika resource tidak ditemukan atau tidak boleh diungkap keberadaannya.

```json
{
  "type": "https://api.example.com/problems/resource-not-found",
  "title": "Resource not found",
  "status": 404,
  "detail": "The requested case was not found.",
  "code": "RESOURCE_NOT_FOUND",
  "resourceType": "case",
  "correlationId": "01JZ..."
}
```

Hati-hati dengan `resourceId`. Untuk API internal mungkin aman, untuk public API bisa sensitif.

### 5.5 405 Method Not Allowed

Response harus menyertakan `Allow` header.

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, PATCH, DELETE
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/method-not-allowed",
  "title": "Method not allowed",
  "status": 405,
  "detail": "POST is not allowed for this resource.",
  "code": "METHOD_NOT_ALLOWED",
  "allowedMethods": ["GET", "PATCH", "DELETE"]
}
```

### 5.6 409 Conflict

Gunakan ketika request valid tetapi bertabrakan dengan current state resource/system.

Contoh:

```json
{
  "type": "https://api.example.com/problems/case-transition-not-allowed",
  "title": "Case transition is not allowed",
  "status": 409,
  "detail": "The case cannot be approved from its current state.",
  "code": "CASE_TRANSITION_NOT_ALLOWED",
  "currentState": "UNDER_REVIEW",
  "requestedTransition": "APPROVE",
  "allowedTransitions": ["REQUEST_CHANGES", "ESCALATE"]
}
```

### 5.7 412 Precondition Failed

Gunakan ketika conditional request gagal, misalnya `If-Match` tidak cocok.

```http
HTTP/1.1 412 Precondition Failed
ETag: "case-123-v8"
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "detail": "The supplied resource version does not match the current version.",
  "code": "PRECONDITION_FAILED",
  "currentVersion": "8",
  "correlationId": "01JZ..."
}
```

### 5.8 415 Unsupported Media Type

Gunakan ketika request body media type tidak didukung.

```json
{
  "type": "https://api.example.com/problems/unsupported-media-type",
  "title": "Unsupported media type",
  "status": 415,
  "detail": "Content-Type 'text/plain' is not supported. Use 'application/json'.",
  "code": "UNSUPPORTED_MEDIA_TYPE",
  "supportedMediaTypes": ["application/json"]
}
```

### 5.9 422 Unprocessable Content

Gunakan ketika request syntactically valid dan media type dipahami, tetapi content tidak valid secara semantic/validation.

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "errors": [
    {
      "field": "dueDate",
      "code": "DATE_MUST_BE_FUTURE",
      "message": "must be in the future"
    }
  ]
}
```

Beberapa organisasi memilih `400` untuk semua validation error. Itu bisa diterima jika konsisten dan terdokumentasi. Yang buruk adalah campur aduk tanpa rule.

### 5.10 429 Too Many Requests

Gunakan untuk rate limiting. Sertakan `Retry-After` jika bisa.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests. Try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfterSeconds": 60
}
```

### 5.11 500 Internal Server Error

Gunakan untuk unexpected server bug/failure. Response harus generik.

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "The server encountered an unexpected condition.",
  "code": "INTERNAL_ERROR",
  "correlationId": "01JZ..."
}
```

### 5.12 503 Service Unavailable

Gunakan saat service overload, maintenance, dependency critical unavailable, atau load shedding.

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 120
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/service-unavailable",
  "title": "Service unavailable",
  "status": 503,
  "detail": "The service is temporarily unavailable. Try again later.",
  "code": "SERVICE_UNAVAILABLE",
  "retryAfterSeconds": 120
}
```

---

## 6. Designing Field-Level Validation Errors

Validation error adalah error yang paling sering berinteraksi dengan frontend/mobile/client. Jangan desain asal.

### 6.1 Shape dasar

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "errors": [
    {
      "field": "respondent.email",
      "code": "EMAIL_INVALID",
      "message": "must be a valid email address"
    }
  ]
}
```

### 6.2 Field path format

Kamu perlu memilih format field path.

Pilihan umum:

```text
respondent.email
respondents[0].email
/evidence/0/fileName
$.respondents[0].email
```

Rekomendasi pragmatis:

- Untuk API JSON sederhana: dot/bracket path cukup.
- Untuk JSON Patch atau tooling berbasis JSON Pointer: gunakan JSON Pointer.
- Dokumentasikan formatnya.
- Jangan ganti format antar-endpoint.

Contoh dot/bracket:

```json
{
  "field": "evidenceItems[0].fileName",
  "code": "REQUIRED",
  "message": "must not be blank"
}
```

Contoh JSON Pointer:

```json
{
  "pointer": "/evidenceItems/0/fileName",
  "code": "REQUIRED",
  "message": "must not be blank"
}
```

### 6.3 Jangan bergantung pada message

Frontend sebaiknya menggunakan `code` untuk mapping UI.

Buruk:

```js
if (error.message === 'must not be blank') {
  showRequiredMarker();
}
```

Baik:

```js
if (error.code === 'REQUIRED') {
  showRequiredMarker();
}
```

### 6.4 Multiple errors per field

Satu field bisa punya lebih dari satu error.

```json
{
  "errors": [
    {
      "field": "password",
      "code": "TOO_SHORT",
      "message": "must be at least 12 characters"
    },
    {
      "field": "password",
      "code": "MISSING_COMPLEXITY_REQUIREMENT",
      "message": "must contain at least one uppercase letter"
    }
  ]
}
```

Decide apakah kamu ingin:

- fail-fast per field,
- aggregate semua error field,
- aggregate hanya error yang aman/berguna.

Untuk UI form, aggregate lebih nyaman. Untuk expensive domain validation, fail-fast bisa lebih efisien.

### 6.5 Object-level validation

Tidak semua error melekat pada satu field.

Contoh:

```text
startDate must be before endDate
at least one of email or phone must be provided
```

Shape:

```json
{
  "errors": [
    {
      "fields": ["startDate", "endDate"],
      "code": "INVALID_DATE_RANGE",
      "message": "startDate must be before endDate"
    },
    {
      "fields": ["email", "phone"],
      "code": "CONTACT_METHOD_REQUIRED",
      "message": "at least one contact method is required"
    }
  ]
}
```

Atau:

```json
{
  "errors": [
    {
      "scope": "object",
      "code": "INVALID_DATE_RANGE",
      "message": "startDate must be before endDate"
    }
  ]
}
```

### 6.6 Security-sensitive validation

Jangan membuat error yang membantu attacker enumerate data.

Buruk untuk login:

```json
{
  "code": "EMAIL_NOT_REGISTERED",
  "detail": "No account exists with this email."
}
```

Lebih aman:

```json
{
  "code": "INVALID_CREDENTIALS",
  "detail": "The supplied credentials are invalid."
}
```

Untuk registration, `EMAIL_ALREADY_USED` mungkin diperlukan untuk UX, tetapi perlu rate limiting dan abuse monitoring.

---

## 7. Domain Error Design

Domain error berbeda dari validation error.

Validation menjawab:

> Apakah request input valid?

Domain error menjawab:

> Apakah operasi ini boleh terjadi dalam state domain saat ini?

### 7.1 Contoh regulatory case workflow

Request:

```http
POST /cases/CASE-123/transitions
Content-Type: application/json

{
  "transition": "APPROVE",
  "comment": "All requirements met."
}
```

Current server state:

```text
CASE-123 is UNDER_REVIEW
mandatory evidence review incomplete
```

Response:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/case-transition-not-allowed",
  "title": "Case transition is not allowed",
  "status": 409,
  "detail": "The case cannot be approved because required evidence review is incomplete.",
  "code": "CASE_TRANSITION_NOT_ALLOWED",
  "caseId": "CASE-123",
  "currentState": "UNDER_REVIEW",
  "requestedTransition": "APPROVE",
  "requiredActions": [
    {
      "code": "COMPLETE_EVIDENCE_REVIEW",
      "title": "Complete evidence review"
    }
  ],
  "correlationId": "01JZ..."
}
```

### 7.2 Domain error harus cukup kaya, tetapi tidak overfit UI

Jangan bentuk error semata-mata mengikuti kebutuhan satu layar frontend.

Buruk:

```json
{
  "showModal": true,
  "modalTitle": "Cannot Approve",
  "buttonText": "Go to Evidence Tab"
}
```

Baik:

```json
{
  "code": "CASE_TRANSITION_NOT_ALLOWED",
  "requiredActions": [
    {
      "code": "COMPLETE_EVIDENCE_REVIEW",
      "resource": "/cases/CASE-123/evidence-reviews"
    }
  ]
}
```

Frontend bisa memutuskan apakah menampilkan modal, toast, inline message, atau navigation.

### 7.3 Domain error dan audit

Untuk sistem regulatory, error tertentu juga bernilai audit:

- attempted unauthorized action,
- attempted invalid transition,
- rejected submission,
- duplicate idempotency key,
- stale version update,
- evidence upload rejected,
- policy validation failed.

Namun response tidak harus berisi seluruh audit detail. Audit event internal bisa lebih lengkap.

---

## 8. Error Response and Observability

Error response yang bagus selalu punya jalur ke log/trace.

### 8.1 Correlation ID

Tambahkan correlation/request id.

```json
{
  "code": "INTERNAL_ERROR",
  "correlationId": "01JZ8HAB6KYHS9W2VKSHTW1HFQ"
}
```

Header juga berguna:

```http
X-Correlation-ID: 01JZ8HAB6KYHS9W2VKSHTW1HFQ
```

atau gunakan standar distributed tracing seperti `traceparent` untuk trace propagation, sambil tetap menyediakan ID support-friendly jika organisasi menggunakannya.

### 8.2 Log internal harus lebih kaya daripada response

Response:

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "code": "INTERNAL_ERROR",
  "correlationId": "01JZ..."
}
```

Log:

```json
{
  "level": "ERROR",
  "message": "Unhandled exception while approving case",
  "correlationId": "01JZ...",
  "traceId": "...",
  "spanId": "...",
  "http.method": "POST",
  "http.route": "/cases/{caseId}/transitions",
  "http.status_code": 500,
  "caseId": "CASE-123",
  "actorId": "USER-789",
  "exception.type": "java.lang.NullPointerException",
  "exception.stacktrace": "..."
}
```

### 8.3 Metrics

Error response design memengaruhi metrics.

Minimal metrics:

```text
http.server.requests.count{method,route,status}
http.server.requests.duration{method,route,status}
api.errors.count{route,status,code}
```

Hati-hati cardinality:

Buruk:

```text
api.errors.count{caseId="CASE-123",userId="USER-789",detail="..."}
```

Baik:

```text
api.errors.count{route="/cases/{caseId}/transitions",status="409",code="CASE_TRANSITION_NOT_ALLOWED"}
```

### 8.4 Support workflow

Untuk production support, error response harus memungkinkan percakapan seperti:

> “Tolong kirim correlationId dari error yang Anda lihat.”

Dengan correlation id, support engineer bisa menemukan:

- request log,
- application log,
- trace,
- downstream call,
- audit event,
- database transaction marker,
- gateway log.

Tanpa ini, support sering bergantung pada timestamp kasar dan user description.

---

## 9. Security: Apa yang Tidak Boleh Bocor

OWASP menekankan pentingnya error handling yang tidak mengekspos detail internal. Error response harus membantu legitimate client, bukan attacker.

### 9.1 Jangan bocorkan stack trace

Buruk:

```json
{
  "trace": "java.lang.NullPointerException at com.company.caseapi.ApproveCaseService.approve(ApproveCaseService.java:88)"
}
```

Risiko:

- attacker tahu package/class,
- attacker tahu flow internal,
- attacker tahu library/framework,
- attacker bisa mencari vulnerability spesifik,
- data sensitif bisa muncul di exception message.

### 9.2 Jangan bocorkan SQL/internal persistence

Buruk:

```json
{
  "detail": "duplicate key value violates unique constraint uq_case_external_reference"
}
```

Baik:

```json
{
  "type": "https://api.example.com/problems/duplicate-resource",
  "title": "Duplicate resource",
  "status": 409,
  "code": "DUPLICATE_EXTERNAL_REFERENCE",
  "detail": "A case with the supplied external reference already exists."
}
```

### 9.3 Jangan bocorkan internal service topology

Buruk:

```json
{
  "detail": "Failed calling http://identity-service-prod-blue.default.svc.cluster.local:8080/introspect"
}
```

Baik:

```json
{
  "type": "https://api.example.com/problems/dependency-unavailable",
  "title": "Dependency unavailable",
  "status": 503,
  "code": "DEPENDENCY_UNAVAILABLE",
  "detail": "A required service is temporarily unavailable. Try again later."
}
```

### 9.4 Jangan bocorkan token/secret/PII

Exception message sering tanpa sengaja mengandung:

- Authorization header,
- API key,
- session id,
- email,
- phone,
- national identifier,
- file path,
- signed URL,
- internal object key,
- raw payload.

Response tidak boleh memuat ini. Log pun perlu redaction.

### 9.5 Error sebagai oracle

Error yang terlalu spesifik bisa dipakai untuk enumeration.

Contoh risk:

```text
GET /users/alice@example.com
404 EMAIL_NOT_FOUND
```

atau:

```text
POST /login
401 PASSWORD_WRONG
```

Lebih aman:

```text
401 INVALID_CREDENTIALS
```

Untuk authorization:

```text
403 USER_NOT_ASSIGNED_TO_CASE_BUT_CASE_EXISTS_IN_TENANT_X
```

bisa menjadi data leak. Pertimbangkan `404` atau generic `403`.

---

## 10. Java/Spring MVC Implementation Pattern

Spring modern menyediakan `ProblemDetail` dan `ErrorResponse` support. Namun kamu tetap perlu desain taxonomy dan mapping sendiri.

### 10.1 Domain exception hierarchy

Contoh struktur:

```java
public abstract class ApiException extends RuntimeException {
    private final String code;
    private final HttpStatus status;

    protected ApiException(String code, HttpStatus status, String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String code() {
        return code;
    }

    public HttpStatus status() {
        return status;
    }
}
```

Domain exception:

```java
public final class CaseTransitionNotAllowedException extends ApiException {
    private final String caseId;
    private final String currentState;
    private final String requestedTransition;

    public CaseTransitionNotAllowedException(
            String caseId,
            String currentState,
            String requestedTransition
    ) {
        super(
            "CASE_TRANSITION_NOT_ALLOWED",
            HttpStatus.CONFLICT,
            "The case cannot transition from its current state."
        );
        this.caseId = caseId;
        this.currentState = currentState;
        this.requestedTransition = requestedTransition;
    }

    public String caseId() { return caseId; }
    public String currentState() { return currentState; }
    public String requestedTransition() { return requestedTransition; }
}
```

### 10.2 Centralized exception handler

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(CaseTransitionNotAllowedException.class)
    public ResponseEntity<ProblemDetail> handleCaseTransition(
            CaseTransitionNotAllowedException ex,
            HttpServletRequest request
    ) {
        ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        pd.setType(URI.create("https://api.example.com/problems/case-transition-not-allowed"));
        pd.setTitle("Case transition is not allowed");
        pd.setDetail(ex.getMessage());
        pd.setInstance(URI.create(request.getRequestURI()));
        pd.setProperty("code", ex.code());
        pd.setProperty("caseId", ex.caseId());
        pd.setProperty("currentState", ex.currentState());
        pd.setProperty("requestedTransition", ex.requestedTransition());
        pd.setProperty("correlationId", currentCorrelationId());

        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(pd);
    }
}
```

### 10.3 Validation error handler

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ProblemDetail> handleValidation(
        MethodArgumentNotValidException ex,
        HttpServletRequest request
) {
    ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_ENTITY);
    pd.setType(URI.create("https://api.example.com/problems/validation-error"));
    pd.setTitle("Validation failed");
    pd.setDetail("One or more fields are invalid.");
    pd.setInstance(URI.create(request.getRequestURI()));
    pd.setProperty("code", "VALIDATION_FAILED");
    pd.setProperty("correlationId", currentCorrelationId());

    List<Map<String, Object>> errors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .map(fieldError -> Map.<String, Object>of(
                    "field", fieldError.getField(),
                    "code", mapValidationCode(fieldError.getCode()),
                    "message", safeValidationMessage(fieldError)
            ))
            .toList();

    pd.setProperty("errors", errors);

    return ResponseEntity
            .status(HttpStatus.UNPROCESSABLE_ENTITY)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(pd);
}
```

### 10.4 Malformed JSON handler

Spring MVC often raises `HttpMessageNotReadableException` for unreadable body.

```java
@ExceptionHandler(HttpMessageNotReadableException.class)
public ResponseEntity<ProblemDetail> handleUnreadableBody(
        HttpMessageNotReadableException ex,
        HttpServletRequest request
) {
    ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
    pd.setType(URI.create("https://api.example.com/problems/malformed-request"));
    pd.setTitle("Malformed request");
    pd.setDetail("The request body could not be parsed.");
    pd.setInstance(URI.create(request.getRequestURI()));
    pd.setProperty("code", "MALFORMED_REQUEST");
    pd.setProperty("correlationId", currentCorrelationId());

    return ResponseEntity
            .badRequest()
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(pd);
}
```

Jangan expose Jackson parser detail mentah jika berisi raw payload atau internal type.

### 10.5 Fallback handler

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<ProblemDetail> handleUnexpected(
        Exception ex,
        HttpServletRequest request
) {
    String correlationId = currentCorrelationId();

    log.error("Unhandled exception, correlationId={}", correlationId, ex);

    ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    pd.setType(URI.create("https://api.example.com/problems/internal-error"));
    pd.setTitle("Internal Server Error");
    pd.setDetail("The server encountered an unexpected condition.");
    pd.setInstance(URI.create(request.getRequestURI()));
    pd.setProperty("code", "INTERNAL_ERROR");
    pd.setProperty("correlationId", correlationId);

    return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(pd);
}
```

Fallback handler harus:

- log exception lengkap server-side,
- return generic error client-side,
- tidak swallow critical signals silently,
- tidak mengubah semua exception menjadi `200`.

### 10.6 Jangan terlalu banyak exception class

Terlalu banyak exception class bisa membuat taxonomy sulit dirawat.

Pendekatan alternatif:

```java
public record ApiErrorDescriptor(
    String code,
    URI type,
    String title,
    HttpStatus status
) {}
```

Lalu domain exception membawa descriptor.

```java
public final class DomainRuleViolationException extends RuntimeException {
    private final ApiErrorDescriptor descriptor;
    private final Map<String, Object> properties;

    public DomainRuleViolationException(
            ApiErrorDescriptor descriptor,
            String detail,
            Map<String, Object> properties
    ) {
        super(detail);
        this.descriptor = descriptor;
        this.properties = Map.copyOf(properties);
    }

    public ApiErrorDescriptor descriptor() { return descriptor; }
    public Map<String, Object> properties() { return properties; }
}
```

Ini lebih scalable untuk domain besar.

---

## 11. WebFlux Error Handling Pattern

Di WebFlux annotated controller, `@RestControllerAdvice` tetap bisa digunakan. Namun kamu juga perlu sadar bahwa error terjadi dalam reactive pipeline.

### 11.1 Reactive controller error

```java
@PostMapping("/cases/{caseId}/transitions")
public Mono<ResponseEntity<CaseRepresentation>> transition(
        @PathVariable String caseId,
        @RequestBody Mono<TransitionRequest> requestMono
) {
    return requestMono
            .flatMap(request -> caseService.transition(caseId, request))
            .map(ResponseEntity::ok);
}
```

Jika `caseService.transition` menghasilkan `Mono.error(new CaseTransitionNotAllowedException(...))`, handler bisa memetakan ke ProblemDetail.

### 11.2 Functional endpoint error

Untuk functional routing, kamu bisa centralize error dengan `ErrorWebExceptionHandler` atau filter.

Pseudo-pattern:

```java
@Component
public class ApiErrorWebExceptionHandler implements ErrorWebExceptionHandler {

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        ProblemDetail problem = mapToProblemDetail(exchange, ex);
        exchange.getResponse().setStatusCode(HttpStatusCode.valueOf(problem.getStatus()));
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);

        byte[] bytes = serialize(problem);
        DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(bytes);
        return exchange.getResponse().writeWith(Mono.just(buffer));
    }
}
```

Dalam production, hindari custom serialization asal-asalan. Gunakan codec/ObjectMapper yang konsisten dan pastikan DataBuffer lifecycle aman.

### 11.3 Reactive pitfalls

- Error yang terjadi setelah response committed tidak bisa lagi mengubah status/body.
- Streaming response bisa gagal di tengah stream; error mungkin hanya tercatat di log/trace.
- Jangan block event loop saat membuat/logging error.
- Context propagation untuk correlationId harus benar.
- `onErrorResume` yang terlalu luas bisa menyembunyikan bug.

Buruk:

```java
return service.call()
    .onErrorResume(ex -> Mono.just(defaultResponse));
```

Ini mengubah error menjadi fake success.

Lebih baik:

```java
return service.call()
    .onErrorMap(ExternalTimeoutException.class,
        ex -> new DependencyUnavailableException("DEPENDENCY_TIMEOUT"));
```

---

## 12. Error Response Versioning and Evolution

Error contract juga perlu evolusi.

### 12.1 Safe changes

Umumnya aman:

- menambah extension field baru,
- menambah problem type baru untuk scenario baru,
- menambah field error code baru,
- memperbaiki wording `detail`,
- menambah documentation URL.

### 12.2 Potentially breaking changes

Berbahaya:

- mengganti `code`,
- mengganti `type`,
- mengganti status untuk error yang sama tanpa migration,
- mengubah `errors` dari array menjadi object,
- mengubah field path format,
- menghapus field yang documented,
- mengubah semantics retry.

### 12.3 Client contract guidance

Dokumentasikan bahwa client boleh bergantung pada:

```text
status
type
code
errors[].code
errors[].field/pointer
documented extension fields
```

Client tidak boleh bergantung pada:

```text
detail exact wording
title exact wording
field ordering
presence of undocumented properties
localized text
```

---

## 13. Error Documentation

Error response tidak cukup hanya ada di code. Harus terdokumentasi.

### 13.1 Per endpoint

Untuk setiap endpoint penting, dokumentasikan:

```text
POST /cases/{caseId}/transitions

Success:
- 200 OK
- 202 Accepted

Errors:
- 400 MALFORMED_REQUEST
- 401 AUTHENTICATION_REQUIRED
- 403 FORBIDDEN
- 404 RESOURCE_NOT_FOUND
- 409 CASE_TRANSITION_NOT_ALLOWED
- 412 PRECONDITION_FAILED
- 422 VALIDATION_FAILED
- 429 RATE_LIMIT_EXCEEDED
- 500 INTERNAL_ERROR
- 503 SERVICE_UNAVAILABLE
```

### 13.2 Per problem type

Buat katalog:

```text
Problem Type: case-transition-not-allowed
URI: https://api.example.com/problems/case-transition-not-allowed
HTTP Status: 409
Code: CASE_TRANSITION_NOT_ALLOWED
Meaning: Requested transition is invalid for current case state.
Retry: No, unless state changes.
User action: Complete required actions or choose allowed transition.
Extensions:
- currentState: string
- requestedTransition: string
- allowedTransitions: string[]
- requiredActions: object[]
```

### 13.3 Retry guidance

Dokumentasi error harus memberi semantic retry.

| Status/code | Retry? | Reason |
|---|---:|---|
| `400 MALFORMED_REQUEST` | No | Client must change request. |
| `401 AUTHENTICATION_REQUIRED` | After token refresh | Auth state must change. |
| `403 FORBIDDEN` | No | Permission must change. |
| `404 RESOURCE_NOT_FOUND` | Usually no | Resource absent/hidden. |
| `409 CASE_TRANSITION_NOT_ALLOWED` | After state change | Domain state must change. |
| `412 PRECONDITION_FAILED` | After refetch | Client has stale version. |
| `429 RATE_LIMIT_EXCEEDED` | Yes after `Retry-After` | Rate limit window. |
| `500 INTERNAL_ERROR` | Maybe with backoff if operation idempotent | Unknown server failure. |
| `503 SERVICE_UNAVAILABLE` | Yes with backoff / `Retry-After` | Temporary unavailability. |

---

## 14. Error and Idempotency

Error response harus mempertimbangkan idempotency.

### 14.1 Duplicate idempotency key with same payload

Jika request sudah pernah sukses, server bisa replay response.

```http
HTTP/1.1 201 Created
Idempotency-Key: abc-123
```

### 14.2 Duplicate idempotency key with different payload

Ini conflict.

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/idempotency-key-conflict",
  "title": "Idempotency key conflict",
  "status": 409,
  "detail": "The same idempotency key was used with a different request payload.",
  "code": "IDEMPOTENCY_KEY_CONFLICT",
  "correlationId": "01JZ..."
}
```

### 14.3 Unknown outcome

Jika server timeout setelah partial downstream uncertainty, jangan sembarang mengirim success atau deterministic failure.

Possible response:

```http
HTTP/1.1 202 Accepted
Location: /operations/OP-123
```

atau:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 5
```

Desain tergantung apakah operasi sudah diberi operation resource.

---

## 15. Error and Asynchronous Operations

Untuk operasi async, error bisa terjadi di dua fase:

1. Request acceptance error.
2. Operation execution error.

### 15.1 Acceptance error

```http
POST /exports
```

Request invalid:

```http
422 Unprocessable Content
Content-Type: application/problem+json
```

### 15.2 Accepted but later failed

Initial response:

```http
202 Accepted
Location: /operations/OP-123
```

Operation status:

```http
GET /operations/OP-123
```

```json
{
  "id": "OP-123",
  "status": "FAILED",
  "error": {
    "type": "https://api.example.com/problems/export-too-large",
    "title": "Export too large",
    "status": 422,
    "code": "EXPORT_TOO_LARGE",
    "detail": "The export exceeds the maximum allowed size."
  }
}
```

Jangan memaksakan semua async failure sebagai HTTP 500 pada `GET /operations/{id}`. Request membaca operation status berhasil; operation-nya yang gagal. Biasanya HTTP status tetap `200 OK`, dan domain status di body `FAILED`. Namun jika operation resource tidak ditemukan, barulah `404`.

---

## 16. Error Response and Partial Success

Batch API sering punya partial success.

Contoh:

```http
POST /cases/bulk-assignments
```

Jika sebagian berhasil dan sebagian gagal, pilihan desain:

### 16.1 Entire request atomic

Jika atomic, satu error menggagalkan semua.

```http
409 Conflict
```

```json
{
  "code": "BULK_ASSIGNMENT_CONFLICT",
  "errors": [
    {
      "itemId": "CASE-123",
      "code": "CASE_ALREADY_CLOSED"
    }
  ]
}
```

### 16.2 Partial success allowed

Bisa gunakan `200 OK` atau `207 Multi-Status` jika kamu memang ingin semantics multi-status. Banyak JSON APIs memilih `200 OK` dengan result per item.

```json
{
  "summary": {
    "total": 3,
    "succeeded": 2,
    "failed": 1
  },
  "results": [
    {
      "caseId": "CASE-1",
      "status": "SUCCEEDED"
    },
    {
      "caseId": "CASE-2",
      "status": "FAILED",
      "error": {
        "code": "CASE_ALREADY_CLOSED",
        "title": "Case already closed"
      }
    }
  ]
}
```

Kuncinya: dokumentasikan atomicity.

---

## 17. Anti-Patterns

### 17.1 Always 200

Buruk:

```http
HTTP/1.1 200 OK

{
  "success": false,
  "error": "Unauthorized"
}
```

Dampak:

- caches/proxies salah memahami response,
- monitoring tidak melihat error,
- SDK retry logic rusak,
- security tooling bingung,
- load balancer/gateway metrics misleading.

### 17.2 Always 500

Buruk:

```http
500 Internal Server Error
```

untuk:

- invalid input,
- missing token,
- forbidden action,
- not found,
- domain conflict.

Dampak:

- bug server palsu,
- alert noise,
- client tidak tahu cara recover,
- SLO error budget tercemar.

### 17.3 Framework default exposed as contract

Spring Boot default error shape bisa berubah antar versi/konfigurasi. Jangan jadikan itu kontrak publik tanpa sengaja.

### 17.4 Error code random

Buruk:

```json
{
  "code": "ERR_001"
}
```

Jika `ERR_001` tidak punya taxonomy/documentation, nilainya rendah.

Lebih baik:

```json
{
  "code": "VALIDATION_FAILED"
}
```

atau:

```json
{
  "code": "CASE_TRANSITION_NOT_ALLOWED"
}
```

### 17.5 Localized message sebagai machine contract

Buruk:

```json
{
  "message": "Tanggal jatuh tempo harus di masa depan"
}
```

lalu mobile app melakukan string matching.

Baik:

```json
{
  "code": "DATE_MUST_BE_FUTURE",
  "message": "Tanggal jatuh tempo harus di masa depan"
}
```

### 17.6 Leaking internal exception type

Buruk:

```json
{
  "exception": "org.hibernate.exception.ConstraintViolationException"
}
```

### 17.7 Too much detail for authorization failure

Buruk:

```json
{
  "detail": "You are not assigned to case CASE-123 under tenant BANK-ABC but it exists and is currently under investigation."
}
```

Lebih aman:

```json
{
  "title": "Forbidden",
  "detail": "You do not have permission to access this resource."
}
```

Atau `404` jika resource hiding diperlukan.

---

## 18. Practical Design Blueprint

Untuk mendesain error system dari nol, gunakan blueprint ini.

### Step 1 — Tentukan standard envelope

Gunakan Problem Details:

```json
{
  "type": "...",
  "title": "...",
  "status": 0,
  "detail": "...",
  "instance": "...",
  "code": "...",
  "correlationId": "..."
}
```

### Step 2 — Tentukan extension fields umum

Rekomendasi:

```text
code
correlationId
errors
retryAfterSeconds
resourceType
currentState
requestedTransition
allowedTransitions
requiredActions
```

Jangan semua field muncul di semua error. Tetapi jika muncul, semantics-nya harus konsisten.

### Step 3 — Buat problem catalog

Minimal:

```text
MALFORMED_REQUEST
VALIDATION_FAILED
AUTHENTICATION_REQUIRED
FORBIDDEN
RESOURCE_NOT_FOUND
METHOD_NOT_ALLOWED
UNSUPPORTED_MEDIA_TYPE
RESOURCE_CONFLICT
PRECONDITION_FAILED
RATE_LIMIT_EXCEEDED
INTERNAL_ERROR
SERVICE_UNAVAILABLE
UPSTREAM_TIMEOUT
```

Domain-specific:

```text
CASE_TRANSITION_NOT_ALLOWED
CASE_ALREADY_CLOSED
EVIDENCE_REVIEW_INCOMPLETE
IDEMPOTENCY_KEY_CONFLICT
DUPLICATE_EXTERNAL_REFERENCE
EXPORT_TOO_LARGE
```

### Step 4 — Map exception to problem

Buat table:

| Exception/source | Status | Code | Log level |
|---|---:|---|---|
| `HttpMessageNotReadableException` | 400 | `MALFORMED_REQUEST` | WARN |
| `MethodArgumentNotValidException` | 422 | `VALIDATION_FAILED` | INFO/WARN |
| `AccessDeniedException` | 403 | `FORBIDDEN` | WARN |
| `EntityNotFoundException` | 404 | `RESOURCE_NOT_FOUND` | INFO |
| `OptimisticLockingFailureException` | 409/412 | `RESOURCE_VERSION_CONFLICT` | INFO/WARN |
| `DuplicateKeyException` | 409 | `DUPLICATE_RESOURCE` | INFO/WARN |
| `TimeoutException` dependency | 503/504 | `UPSTREAM_TIMEOUT` | ERROR/WARN |
| Unknown `Exception` | 500 | `INTERNAL_ERROR` | ERROR |

### Step 5 — Integrate observability

Every problem response should carry:

- correlationId or traceId,
- status,
- code,
- route in log/metric,
- safe actor/tenant context in log if allowed,
- exception detail only server-side.

### Step 6 — Contract tests

Test response shape.

```java
mockMvc.perform(post("/cases")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{ invalid json"))
    .andExpect(status().isBadRequest())
    .andExpect(header().string("Content-Type", startsWith("application/problem+json")))
    .andExpect(jsonPath("$.type").value("https://api.example.com/problems/malformed-request"))
    .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"))
    .andExpect(jsonPath("$.trace").doesNotExist());
```

---

## 19. Case Study: Enforcement Case API Error Model

Bayangkan API:

```text
POST /cases
GET /cases/{caseId}
PATCH /cases/{caseId}
POST /cases/{caseId}/transitions
POST /cases/{caseId}/evidence
POST /cases/{caseId}/assignments
```

### 19.1 Create case validation error

```http
POST /cases
Content-Type: application/json
```

```json
{
  "externalReference": "",
  "respondent": {
    "email": "not-an-email"
  }
}
```

Response:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.regulator.example/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/cases",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZ9QFQ4X5D12V4Z3QTP3PV6A",
  "errors": [
    {
      "field": "externalReference",
      "code": "REQUIRED",
      "message": "must not be blank"
    },
    {
      "field": "respondent.email",
      "code": "EMAIL_INVALID",
      "message": "must be a valid email address"
    }
  ]
}
```

### 19.2 Duplicate external reference

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.regulator.example/problems/duplicate-external-reference",
  "title": "Duplicate external reference",
  "status": 409,
  "detail": "A case with the supplied external reference already exists.",
  "instance": "/cases",
  "code": "DUPLICATE_EXTERNAL_REFERENCE",
  "correlationId": "01JZ9Q..."
}
```

Do not leak database unique constraint name.

### 19.3 Hidden case

If user has no access to case existence:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.regulator.example/problems/resource-not-found",
  "title": "Resource not found",
  "status": 404,
  "detail": "The requested resource was not found.",
  "instance": "/cases/CASE-123",
  "code": "RESOURCE_NOT_FOUND",
  "correlationId": "01JZ9Q..."
}
```

Internal audit log may record attempted access.

### 19.4 Transition not allowed

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.regulator.example/problems/case-transition-not-allowed",
  "title": "Case transition is not allowed",
  "status": 409,
  "detail": "The case cannot transition to APPROVED because required evidence review is incomplete.",
  "instance": "/cases/CASE-123/transitions",
  "code": "CASE_TRANSITION_NOT_ALLOWED",
  "currentState": "UNDER_REVIEW",
  "requestedTransition": "APPROVE",
  "allowedTransitions": ["REQUEST_CHANGES", "ESCALATE"],
  "requiredActions": [
    {
      "code": "COMPLETE_EVIDENCE_REVIEW",
      "resource": "/cases/CASE-123/evidence-reviews"
    }
  ],
  "correlationId": "01JZ9Q..."
}
```

### 19.5 Version conflict

```http
PATCH /cases/CASE-123
If-Match: "case-123-v7"
```

Server current version is 8.

```http
HTTP/1.1 412 Precondition Failed
ETag: "case-123-v8"
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.regulator.example/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "detail": "The resource has changed since it was last retrieved.",
  "instance": "/cases/CASE-123",
  "code": "PRECONDITION_FAILED",
  "currentVersion": "8",
  "correlationId": "01JZ9Q..."
}
```

### 19.6 Evidence upload too large

```http
HTTP/1.1 413 Content Too Large
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.regulator.example/problems/content-too-large",
  "title": "Content too large",
  "status": 413,
  "detail": "The uploaded file exceeds the maximum allowed size.",
  "instance": "/cases/CASE-123/evidence",
  "code": "CONTENT_TOO_LARGE",
  "maxSizeBytes": 52428800,
  "correlationId": "01JZ9Q..."
}
```

---

## 20. Testing Strategy

### 20.1 Unit test mapper

Test error mapper independent dari controller.

```java
@Test
void mapsCaseTransitionExceptionToProblem() {
    var ex = new CaseTransitionNotAllowedException("CASE-123", "UNDER_REVIEW", "APPROVE");

    ProblemDetail pd = mapper.toProblem(ex, URI.create("/cases/CASE-123/transitions"));

    assertThat(pd.getStatus()).isEqualTo(409);
    assertThat(pd.getTitle()).isEqualTo("Case transition is not allowed");
    assertThat(pd.getProperties()).containsEntry("code", "CASE_TRANSITION_NOT_ALLOWED");
}
```

### 20.2 MVC integration test

```java
mockMvc.perform(post("/cases/CASE-123/transitions")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"transition\":\"APPROVE\"}"))
    .andExpect(status().isConflict())
    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
    .andExpect(jsonPath("$.code").value("CASE_TRANSITION_NOT_ALLOWED"))
    .andExpect(jsonPath("$.trace").doesNotExist())
    .andExpect(jsonPath("$.exception").doesNotExist());
```

### 20.3 Security test

Assert no sensitive fields:

```java
.andExpect(jsonPath("$.stackTrace").doesNotExist())
.andExpect(jsonPath("$.trace").doesNotExist())
.andExpect(jsonPath("$.exception").doesNotExist())
.andExpect(jsonPath("$.sql").doesNotExist())
.andExpect(jsonPath("$.authorization").doesNotExist());
```

### 20.4 Contract test

Consumer-driven contract should verify:

- status,
- content type,
- problem type,
- code,
- field errors shape,
- documented extension fields.

It should not verify exact `detail` wording unless intentionally stable.

### 20.5 Chaos/failure tests

Simulate:

- dependency timeout,
- DB unique constraint,
- optimistic lock conflict,
- invalid JSON,
- unsupported media type,
- missing authentication,
- forbidden access,
- resource hiding,
- rate limit exceeded,
- client disconnect if possible.

---

## 21. Production Checklist

Sebelum error system dianggap production-ready, cek:

### Contract

- [ ] Semua error response memakai shape konsisten.
- [ ] `Content-Type` memakai `application/problem+json` untuk problem response.
- [ ] `status` di body cocok dengan HTTP status line.
- [ ] `type` stabil dan terdokumentasi.
- [ ] `code` stabil dan terdokumentasi.
- [ ] Field validation errors punya shape konsisten.
- [ ] Client guidance menjelaskan field mana yang boleh diparse.

### Semantics

- [ ] 400 vs 422 rule jelas.
- [ ] 401 vs 403 rule jelas.
- [ ] 404 hiding policy jelas.
- [ ] 409 vs 412 rule jelas.
- [ ] 429 menyertakan retry guidance jika memungkinkan.
- [ ] 5xx tidak dipakai untuk expected domain rejection.

### Security

- [ ] Stack trace tidak pernah muncul di response production.
- [ ] Exception class tidak muncul di response.
- [ ] SQL/database detail tidak muncul di response.
- [ ] Internal host/service URL tidak muncul di response.
- [ ] Token/secret/header sensitif tidak muncul di response.
- [ ] Authorization error tidak menjadi enumeration oracle.
- [ ] Error logging melakukan redaction.

### Observability

- [ ] Response punya correlation id atau trace id.
- [ ] Log menyimpan correlation id.
- [ ] Metrics punya status/code distribution.
- [ ] High-cardinality labels dihindari.
- [ ] Unexpected 5xx dilog dengan stack trace server-side.
- [ ] Expected 4xx tidak membuat alert noise berlebihan.

### Java/Spring

- [ ] Ada centralized exception handling.
- [ ] Fallback exception handler aman.
- [ ] Validation exception mapped konsisten.
- [ ] Security exceptions mapped konsisten.
- [ ] Persistence exceptions tidak bocor.
- [ ] WebFlux reactive errors tidak swallowed.
- [ ] Tests memastikan no stack trace leakage.

---

## 22. Exercises

### Exercise 1 — Design validation error

Desain error response untuk request:

```json
{
  "respondent": {
    "email": "abc",
    "phone": ""
  },
  "dueDate": "2020-01-01"
}
```

Rules:

- email must be valid,
- at least one contact method must be valid,
- dueDate must be future.

Tentukan:

- HTTP status,
- problem type,
- code,
- field/object errors.

### Exercise 2 — Choose status

Pilih status dan problem code untuk scenario:

1. Missing Authorization header.
2. Valid token but user cannot access case.
3. Case exists but should be hidden from user.
4. JSON body malformed.
5. `Content-Type: text/plain` sent to JSON endpoint.
6. Case version stale with `If-Match`.
7. Duplicate idempotency key with different payload.
8. Evidence storage timeout.
9. User tries to approve already closed case.
10. System throws unexpected `NullPointerException`.

### Exercise 3 — Refactor bad error

Bad response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "success": false,
  "message": "org.hibernate.exception.ConstraintViolationException: duplicate key value violates unique constraint uq_case_ref"
}
```

Refactor menjadi Problem Details yang aman dan benar.

### Exercise 4 — Design problem catalog

Buat problem catalog untuk module `Evidence Management` dengan minimal:

- upload too large,
- unsupported file type,
- virus scan failed,
- evidence not found,
- evidence locked,
- insufficient permission,
- storage unavailable,
- checksum mismatch.

Untuk masing-masing tentukan:

- status,
- type,
- code,
- retry guidance,
- safe extension fields.

---

## 23. Key Takeaways

1. Error response adalah **kontrak API**, bukan detail exception.
2. Gunakan HTTP status untuk semantics, bukan hanya body `success=false`.
3. Problem Details memberi shape standar: `type`, `title`, `status`, `detail`, `instance`.
4. Tambahkan extension fields seperti `code`, `correlationId`, dan `errors` secara konsisten.
5. Client boleh bergantung pada `status`, `type`, dan `code`; jangan pada free-text `detail`.
6. Validation error perlu field-level structure.
7. Domain error perlu merepresentasikan state conflict/rule rejection tanpa overfit UI.
8. Authorization error harus hati-hati agar tidak menjadi information disclosure oracle.
9. Unexpected server error harus generic ke client, detail lengkap hanya di log internal.
10. Error system yang baik mempercepat debugging, support, audit, incident response, dan client integration.

---

## 24. Referensi

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- Spring Framework Reference — Error Responses and ProblemDetail: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html
- Spring Framework Javadoc — `ProblemDetail`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- OWASP Error Handling Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- OpenTelemetry Semantic Conventions for HTTP: https://opentelemetry.io/docs/specs/semconv/http/

---

## 25. Posisi dalam Seri

Kamu telah menyelesaikan:

- Part 000 — Orientation: HTTP Backend Mental Model
- Part 001 — HTTP Semantics from Server Point of View
- Part 002 — Request Lifecycle: From Socket to Controller
- Part 003 — Methods Deep Dive for Backend Correctness
- Part 004 — Status Codes as Backend State Contracts
- Part 005 — Headers as Backend Control Plane
- Part 006 — Request Body, Response Body, and Message Framing
- Part 007 — URI, Routing, and Resource Modeling
- Part 008 — Content Negotiation and Representation Design
- Part 009 — Validation, Parsing, and Defensive Boundaries
- Part 010 — Error Response Design and Problem Details

Berikutnya:

- Part 011 — Idempotency, Retries, and Exactly-Once Illusions

Seri belum selesai. Masih ada Part 011 sampai Part 032.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-009.md">⬅️ Part 009 — Validation, Parsing, and Defensive Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-011.md">Part 011 — Idempotency, Retries, and Exactly-Once Illusions ➡️</a>
</div>
