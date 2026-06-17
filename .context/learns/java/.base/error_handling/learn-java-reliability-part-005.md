# learn-java-reliability-part-005.md

# Part 005 — Designing Error Contracts for APIs

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Bagian: **005 / 030**  
> Status seri: **Belum selesai**  
> Fokus: merancang kontrak error API yang stabil, aman, operasional, machine-readable, dan selaras dengan reliability engineering.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun fondasi tentang:

1. mental model failure;
2. Java exception semantics;
3. taxonomy exception untuk enterprise system;
4. filosofi fail-fast, fail-safe, fail-closed, dan fail-open.

Bagian ini masuk ke boundary yang sangat penting: **API error contract**.

Banyak sistem Java enterprise gagal bukan karena tidak punya `try-catch`, tetapi karena error yang keluar dari sistem:

- tidak konsisten;
- sulit dipahami client;
- tidak machine-readable;
- leaking stack trace/internal implementation;
- tidak membawa correlation ID;
- tidak membedakan failure yang retryable dan non-retryable;
- terlalu bergantung pada pesan manusia;
- tidak stabil antar versi;
- tidak membantu support/operation melakukan triage;
- tidak dapat dipakai sebagai contract test;
- tidak mencerminkan domain semantics.

Target setelah bagian ini:

> Kamu mampu mendesain error response API sebagai **kontrak formal antar sistem**, bukan sekadar payload JSON ketika terjadi exception.

---

## 1. Core Problem

API sukses biasanya didesain dengan cukup serius:

```json
{
  "id": "APP-2026-0001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-15T10:12:30+07:00"
}
```

Tetapi API error sering didesain asal:

```json
{
  "message": "Something went wrong"
}
```

atau lebih buruk:

```json
{
  "error": "java.lang.NullPointerException: Cannot invoke \"Applicant.getName()\" because applicant is null"
}
```

atau:

```json
{
  "timestamp": "2026-06-15T10:12:31.099+07:00",
  "status": 500,
  "error": "Internal Server Error",
  "trace": "... giant stack trace ...",
  "path": "/api/applications"
}
```

Masalahnya bukan hanya estetika. Error contract yang buruk menyebabkan dampak sistemik:

| Masalah | Dampak |
|---|---|
| Error code tidak stabil | Client sulit membuat handling deterministik |
| Semua error jadi 500 | Monitoring noisy dan client salah retry |
| Semua validasi jadi 400 generik | UX buruk, integrasi sulit debug |
| Stack trace bocor | Security risk |
| Tidak ada correlation ID | Incident triage lambat |
| Tidak ada retry semantics | Retry storm atau failure tidak dipulihkan |
| Tidak ada domain code | Business workflow tidak bisa mengambil keputusan |
| Human message dijadikan logic | Breaking change saat wording berubah |
| Tidak ada versioning | Evolusi API berisiko |

Core problem-nya:

> Error response adalah bagian dari API contract, tetapi sering diperlakukan sebagai sisa dari exception handling internal.

---

## 2. Mental Model: Error Contract sebagai Boundary Language

Bayangkan service kamu punya beberapa lapisan:

```text
Client / Consumer
        |
        v
API Boundary
        |
        v
Application Service
        |
        v
Domain Model
        |
        v
Persistence / External Systems
```

Exception internal boleh kaya, teknis, dan dekat dengan implementation detail:

```java
throw new OptimisticLockingFailureException("Row version mismatch");
```

Tetapi saat keluar lewat API, failure harus diterjemahkan menjadi bahasa boundary:

```json
{
  "type": "https://api.example.com/problems/resource-conflict",
  "title": "Resource conflict",
  "status": 409,
  "detail": "The application was modified by another process. Refresh the data and retry with the latest version.",
  "instance": "/api/applications/APP-2026-0001",
  "code": "APPLICATION_VERSION_CONFLICT",
  "correlationId": "01JZABCDEF9S8X2Y7R6Q5P4N3M",
  "retryable": false
}
```

Error contract adalah bahasa boundary yang menjawab beberapa pertanyaan:

1. **Apa kategori failure-nya?**
2. **Apakah request salah, state salah, dependency gagal, atau server rusak?**
3. **Apakah client boleh retry?**
4. **Apakah user bisa memperbaiki input?**
5. **Apakah operator perlu investigasi?**
6. **Apakah failure ini aman ditampilkan ke user?**
7. **Bagaimana mencari log/trace terkait?**
8. **Apakah error ini bagian dari domain flow normal atau incident?**
9. **Apakah contract ini stabil untuk client automation?**

Mental model yang harus kamu pegang:

> Exception internal adalah diagnosis lokal. Error response adalah kontrak komunikasi antar sistem.

---

## 3. Design Goals Error Contract

Error contract yang matang harus memenuhi beberapa tujuan sekaligus.

### 3.1 Machine-readable

Client tidak boleh parsing `detail` atau `message` untuk membuat keputusan.

Buruk:

```java
if (error.message().contains("already exists")) {
    showDuplicateWarning();
}
```

Lebih benar:

```java
if (error.code().equals("APPLICATION_ALREADY_EXISTS")) {
    showDuplicateWarning();
}
```

`detail` boleh berubah untuk readability. `code` harus stabil.

---

### 3.2 Human-readable

Walaupun machine-readable penting, manusia tetap perlu membaca error:

- developer client;
- QA;
- support;
- operator;
- end user;
- auditor;
- incident commander.

Karena itu error perlu punya `title` dan `detail` yang jelas, tetapi tidak bocor internal.

---

### 3.3 Stable

Error code adalah contract. Jangan ubah seenaknya.

Misalnya:

```text
APPLICATION_ALREADY_EXISTS
```

lebih stabil daripada:

```text
DUPLICATE_APP_V2_NEW
```

Stabil bukan berarti tidak boleh tambah error baru. Stabil berarti:

- error code lama tidak berubah makna;
- HTTP status lama tidak berubah tanpa versioning;
- field wajib tidak hilang;
- client bisa forward-compatible terhadap field tambahan.

---

### 3.4 Secure

Error tidak boleh membocorkan:

- stack trace;
- SQL query internal;
- table name sensitif;
- token;
- secret;
- credential;
- private IP/internal hostname;
- file path server;
- implementation detail framework;
- PII yang tidak perlu;
- authorization rule detail yang bisa dipakai enumerasi.

Contoh buruk:

```json
{
  "error": "ORA-00001: unique constraint (ACEAS_UAT.USR_APP.UK_NRIC) violated"
}
```

Contoh lebih baik:

```json
{
  "code": "APPLICANT_ALREADY_EXISTS",
  "title": "Applicant already exists",
  "status": 409,
  "detail": "An applicant with the same identity already exists."
}
```

---

### 3.5 Operationally useful

Error harus membantu operasi:

- cari log;
- cari trace;
- lihat dependency yang gagal;
- bedakan client error vs server error;
- ukur error rate;
- lihat retry storm;
- lihat rate limit;
- diagnose incident.

Field seperti `correlationId`, `traceId`, `timestamp`, `instance`, dan `code` sangat berguna.

---

### 3.6 Domain-aware

Tidak semua error adalah technical error.

Contoh:

- `APPLICATION_CANNOT_BE_SUBMITTED_FROM_DRAFT_WITH_MISSING_DECLARATION`
- `APPEAL_WINDOW_CLOSED`
- `CASE_ALREADY_ESCALATED`
- `RENEWAL_NOT_ALLOWED_BEFORE_ELIGIBILITY_DATE`
- `DOCUMENT_REQUIRED_FOR_CURRENT_STATUS`

Ini bukan sekadar `400 Bad Request`. Ini business-state failure.

---

### 3.7 Versionable

Error contract harus bisa berevolusi.

Prinsip:

- boleh tambah optional field;
- jangan hapus field existing tanpa major version;
- jangan ubah semantic `code` lama;
- jangan ubah HTTP status sembarangan;
- dokumentasikan deprecation;
- client harus mengabaikan unknown fields.

---

## 4. Foundation: RFC 9457 Problem Details

Untuk HTTP API modern, baseline yang sangat kuat adalah **Problem Details for HTTP APIs**, sekarang distandarkan sebagai RFC 9457 dan menggantikan RFC 7807.

Struktur dasarnya:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/api/applications"
}
```

Field inti:

| Field | Makna |
|---|---|
| `type` | URI yang mengidentifikasi problem type |
| `title` | ringkasan pendek problem type |
| `status` | HTTP status code |
| `detail` | penjelasan spesifik occurrence |
| `instance` | URI/request instance yang mengalami problem |

RFC 9457 sengaja menyediakan format standar agar API tidak perlu menciptakan format error baru untuk setiap sistem. Tetapi format ini juga mendukung extension fields.

Untuk enterprise Java, kita biasanya perlu memperluasnya:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/api/applications",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "timestamp": "2026-06-15T10:12:31.099+07:00",
  "errors": [
    {
      "field": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    }
  ]
}
```

### 4.1 Kenapa tidak cukup pakai HTTP status saja?

HTTP status penting, tetapi terlalu kasar.

`400 Bad Request` bisa berarti:

- JSON malformed;
- missing required field;
- invalid enum;
- invalid date range;
- invalid domain transition;
- unsupported business command;
- duplicate input dalam batch;
- command tidak sesuai current state.

`409 Conflict` bisa berarti:

- duplicate resource;
- optimistic lock conflict;
- business state conflict;
- idempotency conflict;
- uniqueness conflict.

Maka HTTP status adalah **transport-level classification**, sedangkan `code` adalah **application/domain-level classification**.

---

## 5. Canonical Error Schema untuk Seri Ini

Untuk seri ini, kita akan memakai bentuk error contract berikut sebagai baseline.

```json
{
  "type": "https://api.example.com/problems/{problem-type}",
  "title": "Short stable title",
  "status": 400,
  "detail": "Human-readable detail for this specific occurrence.",
  "instance": "/api/resource/123",
  "code": "STABLE_MACHINE_READABLE_CODE",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp": "2026-06-15T10:12:31.099+07:00",
  "retryable": false,
  "severity": "ERROR"
}
```

Optional extension:

```json
{
  "errors": [],
  "violations": [],
  "dependency": "onemap",
  "retryAfterSeconds": 60,
  "documentationUrl": "https://api.example.com/docs/errors#VALIDATION_FAILED",
  "supportReference": "SUP-20260615-ABC123"
}
```

Tetapi jangan semua field dimasukkan ke semua error. Error contract harus kaya, bukan bising.

---

## 6. Field-by-Field Design

### 6.1 `type`

`type` adalah URI problem type.

Contoh:

```json
"type": "https://api.example.com/problems/validation-error"
```

Prinsip:

- stabil;
- tidak harus bisa dibuka browser, tetapi lebih baik kalau bisa;
- representasi kategori problem, bukan occurrence unik;
- jangan berisi data sensitif;
- jangan terlalu granular kalau `code` sudah granular.

Contoh baik:

```text
https://api.example.com/problems/validation-error
https://api.example.com/problems/resource-conflict
https://api.example.com/problems/authentication-required
https://api.example.com/problems/rate-limit-exceeded
https://api.example.com/problems/dependency-unavailable
```

Contoh buruk:

```text
https://api.example.com/problems/null-pointer-exception
https://api.example.com/problems/oracle-constraint-usr_app_uk_nric
https://api.example.com/problems/user-1234-failed-login
```

`type` adalah kategori publik. Internal implementation detail tidak boleh masuk.

---

### 6.2 `title`

`title` adalah ringkasan pendek dari problem type.

Contoh:

```json
"title": "Validation failed"
```

Prinsip:

- pendek;
- stabil;
- bukan tempat detail occurrence;
- bisa dilokalisasi jika sistem mendukung i18n;
- jangan berisi ID/data runtime.

Buruk:

```json
"title": "Validation failed for applicant.email because value x@ is invalid at line 10"
```

Baik:

```json
"title": "Validation failed"
```

---

### 6.3 `status`

`status` adalah HTTP status code.

Prinsip:

- harus sama dengan status HTTP response;
- jangan menjadikan semua error 200;
- jangan menjadikan semua business error 500;
- pilih status berdasarkan semantics, bukan exception class mentah.

Contoh:

| Scenario | HTTP Status |
|---|---:|
| malformed JSON | 400 |
| validation failed | 400 |
| unauthenticated | 401 |
| authenticated but not allowed | 403 |
| resource not found | 404 |
| method not allowed | 405 |
| conflict/current state mismatch | 409 |
| optimistic locking conflict | 409 |
| unsupported media type | 415 |
| semantic validation/domain command invalid | 422, atau 400 jika organisasi tidak memakai 422 |
| rate limit exceeded | 429 |
| server bug/unexpected | 500 |
| dependency unavailable | 502/503 |
| gateway timeout/dependency timeout | 504 |

Catatan penting: pilihan `400` vs `422` sering menjadi standard internal organisasi. Yang lebih penting adalah **konsisten** dan terdokumentasi.

---

### 6.4 `detail`

`detail` menjelaskan occurrence spesifik.

Contoh:

```json
"detail": "Application APP-2026-0001 cannot be submitted because the declaration section is incomplete."
```

Prinsip:

- boleh lebih detail daripada `title`;
- human-readable;
- jangan dipakai client sebagai decision logic;
- jangan bocorkan stack trace;
- jangan bocorkan SQL/table/host/token;
- cukup spesifik untuk user/support;
- aman untuk ditampilkan sesuai audience.

Untuk internal API antar trusted services, detail bisa lebih teknis tetapi tetap jangan bocorkan secret.

---

### 6.5 `instance`

`instance` menunjuk occurrence/request/resource yang terkait error.

Contoh:

```json
"instance": "/api/applications/APP-2026-0001/submission"
```

Bukan tempat menyimpan stack trace atau correlation ID.

Untuk privacy, jangan masukkan data sensitif ke path kalau path itu bisa terlihat di log/proxy.

---

### 6.6 `code`

Ini field extension paling penting untuk enterprise API.

Contoh:

```json
"code": "APPLICATION_VERSION_CONFLICT"
```

Prinsip:

- stable;
- UPPER_SNAKE_CASE;
- domain/application level;
- machine-readable;
- tidak bergantung bahasa manusia;
- documented;
- jangan terlalu generik;
- jangan terlalu implementation-specific.

Buruk:

```text
ERROR
BAD_REQUEST
EXCEPTION
DB_ERROR
ORA_00001
NULL_POINTER
```

Baik:

```text
VALIDATION_FAILED
APPLICATION_ALREADY_EXISTS
APPLICATION_VERSION_CONFLICT
APPEAL_WINDOW_CLOSED
DOCUMENT_REQUIRED
DEPENDENCY_TIMEOUT
RATE_LIMIT_EXCEEDED
IDEMPOTENCY_KEY_CONFLICT
```

#### 6.6.1 Code hierarchy

Untuk sistem besar, gunakan prefix domain:

```text
APPLICATION_VALIDATION_FAILED
APPLICATION_ALREADY_SUBMITTED
APPLICATION_VERSION_CONFLICT
CASE_NOT_ASSIGNABLE
CASE_ALREADY_ESCALATED
DOCUMENT_MISSING_REQUIRED_FILE
AUTH_TOKEN_EXPIRED
INTEGRATION_ONEMAP_RATE_LIMITED
INTEGRATION_ONEMAP_UNAVAILABLE
```

Tetapi hindari code yang terlalu panjang dan terlalu dekat implementation.

---

### 6.7 `correlationId`

`correlationId` adalah ID yang mengikat request lintas log/service.

Contoh:

```json
"correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W"
```

Prinsip:

- diterima dari incoming header jika valid;
- dibuat jika tidak ada;
- diteruskan ke downstream call;
- selalu muncul di log;
- selalu muncul di error response;
- bukan secret;
- tidak boleh berisi PII;
- validasi panjang dan format agar tidak menjadi log injection vector.

Common header:

```text
X-Correlation-Id
X-Request-Id
traceparent
```

Untuk sistem modern dengan distributed tracing, correlation ID sering hidup berdampingan dengan `traceId`.

---

### 6.8 `traceId`

`traceId` menghubungkan response dengan distributed trace.

Contoh:

```json
"traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
```

Prinsip:

- useful untuk observability;
- jangan menggantikan error code;
- jangan mengandalkan traceId saja karena trace sampling bisa membuat trace tidak tersedia;
- tetap log correlationId dan code.

---

### 6.9 `timestamp`

Contoh:

```json
"timestamp": "2026-06-15T10:12:31.099+07:00"
```

Prinsip:

- gunakan ISO-8601/RFC3339 style;
- UTC lebih disukai untuk distributed systems, tetapi offset lokal bisa diterima jika standard organisasi begitu;
- jangan pakai format ambigu;
- jangan jadikan timestamp sebagai unique identifier.

---

### 6.10 `retryable`

`retryable` membantu client mengambil keputusan.

Contoh:

```json
"retryable": true
```

Tetapi hati-hati: `retryable=true` bukan berarti client boleh retry agresif.

Prinsip:

- `true` hanya jika operasi aman di-retry;
- operasi mutating perlu idempotency key;
- rate limit harus disertai `Retry-After` atau `retryAfterSeconds`;
- dependency transient failure bisa retryable jika command idempotent;
- validation error hampir selalu non-retryable tanpa perubahan input;
- authorization error non-retryable kecuali token refresh scenario.

Contoh:

| Error | retryable |
|---|---:|
| malformed JSON | false |
| validation failed | false |
| resource not found | false/depends |
| optimistic conflict | false untuk blind retry, true setelah refresh/rebase |
| rate limit | true setelah delay |
| dependency timeout | true jika idempotent |
| server overloaded | true dengan backoff |
| invariant violation | false |

Kadang satu boolean tidak cukup. Bisa gunakan:

```json
"retry": {
  "allowed": true,
  "afterSeconds": 60,
  "strategy": "BACKOFF_WITH_JITTER"
}
```

Namun untuk public API, simplicity lebih penting.

---

### 6.11 `severity`

Contoh:

```json
"severity": "ERROR"
```

Gunakan hati-hati. Severity untuk client tidak selalu sama dengan severity internal.

Contoh:

- validasi user: `INFO` atau `WARN` internal, tapi response tetap error;
- authentication failure: mungkin `WARN` jika repeated;
- invariant violation: `ERROR` atau `CRITICAL`;
- dependency outage: `ERROR`;
- data corruption risk: `CRITICAL`.

Jangan expose severity internal kalau bisa membingungkan client.

---

### 6.12 `errors` / field-level validation

Untuk validation error, satu `detail` tidak cukup.

Contoh:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "errors": [
    {
      "field": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    },
    {
      "field": "application.type",
      "code": "REQUIRED",
      "message": "Application type is required."
    }
  ]
}
```

Prinsip:

- `field` memakai path stabil dari API payload, bukan Java field internal jika berbeda;
- `code` field-level machine-readable;
- `message` human-readable;
- jangan expose rejected value jika sensitif;
- untuk array, gunakan path yang jelas:

```text
applicants[0].email
items[3].quantity
```

Optional:

```json
{
  "field": "period.endDate",
  "code": "MUST_BE_AFTER",
  "message": "End date must be after start date.",
  "context": {
    "relatedField": "period.startDate"
  }
}
```

---

## 7. HTTP Status Mapping Deep Dive

HTTP status bukan dekorasi. Ia menentukan behavior client, proxy, monitoring, gateway, dan observability.

### 7.1 400 Bad Request

Gunakan untuk request yang syntactically atau structurally invalid.

Contoh:

- malformed JSON;
- missing required query parameter;
- invalid enum;
- invalid field format;
- invalid pagination parameter;
- invalid sort field;
- validation failed.

Contoh response:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "errors": [
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    }
  ]
}
```

### 7.2 401 Unauthorized

Nama status ini agak membingungkan; dalam praktik HTTP, 401 berarti request belum authenticated atau credential invalid/expired.

Gunakan untuk:

- no token;
- invalid token;
- expired token;
- missing authentication challenge.

Jangan pakai 401 untuk user authenticated tapi tidak punya permission. Itu 403.

Contoh:

```json
{
  "type": "https://api.example.com/problems/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "detail": "A valid access token is required.",
  "code": "AUTHENTICATION_REQUIRED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W"
}
```

Security note:

- jangan detailkan apakah username ada atau tidak;
- jangan berikan reason token validation terlalu rinci ke public client;
- log detail internal secara aman.

### 7.3 403 Forbidden

Gunakan ketika principal sudah authenticated tapi tidak boleh melakukan action.

Contoh:

```json
{
  "type": "https://api.example.com/problems/access-denied",
  "title": "Access denied",
  "status": 403,
  "detail": "You are not allowed to submit this application.",
  "code": "ACCESS_DENIED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W"
}
```

Kadang untuk mencegah enumeration, sistem sengaja mengembalikan 404 untuk resource yang tidak boleh diketahui keberadaannya. Ini harus menjadi policy sadar, bukan kebetulan.

### 7.4 404 Not Found

Gunakan ketika resource tidak ditemukan atau sengaja disembunyikan.

Contoh:

```json
{
  "type": "https://api.example.com/problems/resource-not-found",
  "title": "Resource not found",
  "status": 404,
  "detail": "Application APP-2026-0001 was not found.",
  "code": "APPLICATION_NOT_FOUND",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W"
}
```

Hati-hati untuk resource sensitif: detail mungkin perlu lebih generik.

### 7.5 409 Conflict

Gunakan ketika request valid secara format, tetapi bertabrakan dengan current state.

Contoh:

- duplicate resource;
- optimistic lock conflict;
- state transition conflict;
- idempotency key conflict;
- resource already submitted;
- concurrent update.

Contoh:

```json
{
  "type": "https://api.example.com/problems/resource-conflict",
  "title": "Resource conflict",
  "status": 409,
  "detail": "The application was modified by another process. Refresh and try again.",
  "code": "APPLICATION_VERSION_CONFLICT",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": false
}
```

### 7.6 422 Unprocessable Content

Gunakan jika organisasi kamu membedakan:

- `400`: request syntax/shape invalid;
- `422`: request shape valid tetapi semantically invalid.

Contoh:

```json
{
  "type": "https://api.example.com/problems/domain-rule-violation",
  "title": "Domain rule violation",
  "status": 422,
  "detail": "Appeal cannot be submitted because the appeal window is closed.",
  "code": "APPEAL_WINDOW_CLOSED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W"
}
```

Kalau organisasi memilih tidak memakai 422, pakai 400 atau 409 secara konsisten sesuai taxonomy.

### 7.7 429 Too Many Requests

Gunakan untuk rate limiting.

Response harus memberi signal retry delay.

Header:

```text
Retry-After: 60
```

Body:

```json
{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests. Retry after 60 seconds.",
  "code": "RATE_LIMIT_EXCEEDED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true,
  "retryAfterSeconds": 60
}
```

### 7.8 500 Internal Server Error

Gunakan untuk unexpected server failure.

Contoh:

```json
{
  "type": "https://api.example.com/problems/internal-server-error",
  "title": "Internal server error",
  "status": 500,
  "detail": "An unexpected error occurred. Contact support with the correlation ID.",
  "code": "INTERNAL_SERVER_ERROR",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W"
}
```

Jangan expose:

- exception class internal;
- stack trace;
- SQL;
- hostname;
- secret;
- file path.

### 7.9 502 Bad Gateway

Gunakan jika service kamu bertindak sebagai gateway/proxy dan upstream memberi response invalid/error.

Contoh:

```json
{
  "type": "https://api.example.com/problems/dependency-bad-gateway",
  "title": "Dependency error",
  "status": 502,
  "detail": "The address validation provider returned an invalid response.",
  "code": "ADDRESS_PROVIDER_BAD_RESPONSE",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true
}
```

### 7.10 503 Service Unavailable

Gunakan saat service sementara tidak bisa melayani:

- overloaded;
- dependency unavailable;
- draining/shutdown;
- maintenance;
- circuit open.

Contoh:

```json
{
  "type": "https://api.example.com/problems/service-unavailable",
  "title": "Service unavailable",
  "status": 503,
  "detail": "The service is temporarily unavailable. Retry later.",
  "code": "SERVICE_TEMPORARILY_UNAVAILABLE",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true
}
```

### 7.11 504 Gateway Timeout

Gunakan jika upstream/dependency timeout.

```json
{
  "type": "https://api.example.com/problems/dependency-timeout",
  "title": "Dependency timeout",
  "status": 504,
  "detail": "The address validation provider did not respond in time.",
  "code": "ADDRESS_PROVIDER_TIMEOUT",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true
}
```

---

## 8. Error Code Taxonomy

Untuk sistem enterprise, error code sebaiknya diklasifikasi.

### 8.1 Top-level categories

```text
VALIDATION_*
AUTHENTICATION_*
AUTHORIZATION_*
RESOURCE_*
CONFLICT_*
DOMAIN_*
STATE_*
IDEMPOTENCY_*
RATE_LIMIT_*
DEPENDENCY_*
DATABASE_*
SYSTEM_*
```

Tetapi di domain besar, prefix domain lebih berguna:

```text
APPLICATION_*
APPEAL_*
CASE_*
DOCUMENT_*
PROFILE_*
PAYMENT_*
NOTIFICATION_*
INTEGRATION_*
```

### 8.2 Good code properties

Error code yang baik:

- meaningful;
- stable;
- not too generic;
- not too low-level;
- maps to remediation;
- useful for metrics;
- can be documented;
- can be used in tests;
- not tied to vendor implementation.

### 8.3 Examples

| Bad Code | Problem | Better Code |
|---|---|---|
| `ERROR_001` | meaningless | `APPLICATION_ALREADY_EXISTS` |
| `BAD_REQUEST` | too generic | `APPLICATION_DECLARATION_REQUIRED` |
| `ORA_00001` | vendor-specific | `APPLICATION_DUPLICATE_IDENTITY` |
| `NPE` | implementation leak | `INTERNAL_SERVER_ERROR` |
| `FAIL` | no semantics | `ADDRESS_PROVIDER_TIMEOUT` |
| `VALIDATION_ERROR` | okay but coarse | `VALIDATION_FAILED` + field-level codes |

### 8.4 Code lifecycle

Treat error codes like public API.

Lifecycle states:

```text
DRAFT -> ACTIVE -> DEPRECATED -> REMOVED only in major version
```

Rules:

1. Never reuse old code for different meaning.
2. Deprecate instead of mutate semantics.
3. Document known remediation.
4. Add new code when behavior is materially different.
5. Keep mapping tests.

---

## 9. Designing Error Contract by Audience

Error response has multiple consumers.

### 9.1 End user

Needs:

- understandable message;
- what to fix;
- no scary internals;
- localized message maybe.

Example:

```text
Please complete the declaration section before submitting.
```

### 9.2 Frontend application

Needs:

- field-level errors;
- stable code;
- retry hint;
- auth/session behavior;
- conflict handling;
- rate limit handling.

### 9.3 Backend client/service

Needs:

- machine-readable code;
- retryable classification;
- correlation ID;
- idempotency conflict detail;
- dependency-specific categories.

### 9.4 Support team

Needs:

- correlation ID;
- timestamp;
- support reference;
- safe summary;
- known remediation.

### 9.5 Operator/SRE

Needs:

- code in logs and metrics;
- severity;
- trace ID;
- dependency name;
- retry count;
- circuit breaker state;
- rate limit info.

### 9.6 Auditor/regulator

Needs:

- consistent decision reason;
- evidence preservation;
- no sensitive leakage;
- traceability;
- deterministic mapping from business rule to rejection.

Important insight:

> Satu error payload tidak harus melayani semua detail internal, tetapi minimal harus membawa reference yang menghubungkan user-visible error ke operational evidence.

---

## 10. Error Contract vs Log Contract

Jangan campur error response dan log.

### 10.1 Error response

Untuk client.

Harus:

- safe;
- stable;
- concise;
- machine-readable;
- tidak bocor internal;
- membantu client/user.

### 10.2 Log

Untuk operator/developer.

Boleh berisi:

- exception class;
- stack trace;
- cause chain;
- sanitized request context;
- dependency status;
- retry attempt;
- transaction ID;
- internal state;
- mapped error code.

Tetapi log juga tidak boleh berisi secret/PII sembarangan.

### 10.3 Golden rule

> Client menerima `correlationId`; operator menggunakan `correlationId` untuk menemukan detail internal di log/trace.

---

## 11. Security Design for API Errors

OWASP guidance secara umum menekankan bahwa error handling harus mencegah leakage informasi sensitif dan dikonfigurasi secara global. Untuk API, prinsip ini berarti: public response harus minimal dan aman, sementara detail teknis masuk ke log internal yang terlindungi.

### 11.1 Jangan expose stack trace

Buruk:

```json
{
  "trace": "java.lang.NullPointerException at com.company..."
}
```

Risiko:

- reveal package/class structure;
- reveal framework version;
- reveal SQL/table;
- reveal internal path;
- membantu attacker fingerprint sistem.

### 11.2 Jangan expose authentication detail berlebihan

Buruk:

```json
{
  "detail": "User fajar@example.com exists but password is wrong"
}
```

Lebih aman:

```json
{
  "code": "INVALID_CREDENTIALS",
  "detail": "Invalid credentials."
}
```

### 11.3 Jangan expose authorization policy terlalu rinci

Buruk:

```json
{
  "detail": "You need ROLE_CASE_SUPERVISOR_L2 to access this case assigned to Officer Tan"
}
```

Lebih aman:

```json
{
  "code": "ACCESS_DENIED",
  "detail": "You are not allowed to access this resource."
}
```

Internal log boleh menyimpan reason yang sanitized.

### 11.4 Jangan expose rejected value jika sensitif

Buruk:

```json
{
  "field": "nric",
  "message": "NRIC S1234567D is invalid"
}
```

Lebih aman:

```json
{
  "field": "nric",
  "code": "IDENTITY_FORMAT_INVALID",
  "message": "Identity number format is invalid."
}
```

### 11.5 Prevent log injection

Jika `correlationId` diterima dari client, validasi:

- max length;
- allowed characters;
- no newline;
- no control chars.

Contoh:

```java
private static final Pattern SAFE_CORRELATION_ID =
        Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");
```

Jika invalid, generate baru.

---

## 12. Java/Spring Implementation Model

Bagian ini tidak mengulang dasar Spring MVC. Fokusnya adalah desain error contract.

### 12.1 Domain exception

```java
public abstract class DomainException extends RuntimeException {
    private final String code;
    private final boolean retryable;

    protected DomainException(String code, String message, boolean retryable) {
        super(message);
        this.code = code;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

Contoh:

```java
public final class ApplicationVersionConflictException extends DomainException {
    public ApplicationVersionConflictException(String applicationId) {
        super(
            "APPLICATION_VERSION_CONFLICT",
            "Application " + applicationId + " was modified by another process.",
            false
        );
    }
}
```

Catatan:

- message internal bisa lebih detail;
- public detail boleh dibangun terpisah;
- jangan masukkan sensitive value ke exception message jika log akan menyimpannya.

---

### 12.2 Error code enum

Untuk sistem besar, enum bisa membantu compile-time safety.

```java
public enum ApiErrorCode {
    VALIDATION_FAILED,
    MALFORMED_REQUEST,
    AUTHENTICATION_REQUIRED,
    ACCESS_DENIED,
    APPLICATION_NOT_FOUND,
    APPLICATION_ALREADY_EXISTS,
    APPLICATION_VERSION_CONFLICT,
    IDEMPOTENCY_KEY_CONFLICT,
    RATE_LIMIT_EXCEEDED,
    DEPENDENCY_TIMEOUT,
    DEPENDENCY_UNAVAILABLE,
    INTERNAL_SERVER_ERROR
}
```

Namun enum juga bisa menyulitkan jika error code berasal dari modular domain yang berkembang cepat. Alternatifnya gunakan class registry.

---

### 12.3 Error descriptor

Pisahkan exception dari public mapping.

```java
public record ErrorDescriptor(
        String type,
        String title,
        int status,
        String code,
        boolean retryable
) {
}
```

Registry:

```java
public final class ErrorDescriptors {
    private ErrorDescriptors() {}

    public static final ErrorDescriptor APPLICATION_VERSION_CONFLICT =
        new ErrorDescriptor(
            "https://api.example.com/problems/resource-conflict",
            "Resource conflict",
            409,
            "APPLICATION_VERSION_CONFLICT",
            false
        );

    public static final ErrorDescriptor INTERNAL_SERVER_ERROR =
        new ErrorDescriptor(
            "https://api.example.com/problems/internal-server-error",
            "Internal server error",
            500,
            "INTERNAL_SERVER_ERROR",
            false
        );
}
```

Benefit:

- mapping terdokumentasi;
- testable;
- bisa generate docs;
- bisa dibuat metric label;
- menghindari random string tersebar.

---

### 12.4 API error response record

```java
import java.time.OffsetDateTime;
import java.util.List;

public record ApiErrorResponse(
        String type,
        String title,
        int status,
        String detail,
        String instance,
        String code,
        String correlationId,
        String traceId,
        OffsetDateTime timestamp,
        Boolean retryable,
        List<FieldErrorItem> errors
) {
    public record FieldErrorItem(
            String field,
            String code,
            String message
    ) {}
}
```

Catatan:

- gunakan `Boolean` jika ingin omit null via Jackson config;
- `errors` null atau empty tergantung style;
- pastikan serialization contract stabil.

---

### 12.5 Centralized handler

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    private final CorrelationIdProvider correlationIdProvider;
    private final TraceIdProvider traceIdProvider;

    public ApiExceptionHandler(
            CorrelationIdProvider correlationIdProvider,
            TraceIdProvider traceIdProvider
    ) {
        this.correlationIdProvider = correlationIdProvider;
        this.traceIdProvider = traceIdProvider;
    }

    @ExceptionHandler(ApplicationVersionConflictException.class)
    public ResponseEntity<ApiErrorResponse> handleVersionConflict(
            ApplicationVersionConflictException ex,
            HttpServletRequest request
    ) {
        ApiErrorResponse body = new ApiErrorResponse(
            "https://api.example.com/problems/resource-conflict",
            "Resource conflict",
            409,
            "The application was modified by another process. Refresh and try again.",
            request.getRequestURI(),
            ex.code(),
            correlationIdProvider.currentId(),
            traceIdProvider.currentTraceIdOrNull(),
            OffsetDateTime.now(),
            ex.retryable(),
            List.of()
        );

        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(
            Exception ex,
            HttpServletRequest request
    ) {
        // Log full exception internally with correlation id.
        // Do not expose stack trace in response.
        ApiErrorResponse body = new ApiErrorResponse(
            "https://api.example.com/problems/internal-server-error",
            "Internal server error",
            500,
            "An unexpected error occurred. Contact support with the correlation ID.",
            request.getRequestURI(),
            "INTERNAL_SERVER_ERROR",
            correlationIdProvider.currentId(),
            traceIdProvider.currentTraceIdOrNull(),
            OffsetDateTime.now(),
            false,
            List.of()
        );

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
    }
}
```

Important:

- specific handlers before generic;
- generic handler logs exception;
- response generic and safe;
- mapping deterministic.

---

### 12.6 Using Spring `ProblemDetail`

Spring Framework supports `ProblemDetail` and `ErrorResponse` model aligned with RFC 9457-style problem details.

Example:

```java
@ExceptionHandler(ApplicationVersionConflictException.class)
public ResponseEntity<ProblemDetail> handleVersionConflict(
        ApplicationVersionConflictException ex,
        HttpServletRequest request
) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
    problem.setType(URI.create("https://api.example.com/problems/resource-conflict"));
    problem.setTitle("Resource conflict");
    problem.setDetail("The application was modified by another process. Refresh and try again.");
    problem.setInstance(URI.create(request.getRequestURI()));
    problem.setProperty("code", ex.code());
    problem.setProperty("correlationId", correlationIdProvider.currentId());
    problem.setProperty("retryable", ex.retryable());

    return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
}
```

Trade-off:

| Approach | Pros | Cons |
|---|---|---|
| Custom `ApiErrorResponse` | full control, explicit schema | must maintain yourself |
| Spring `ProblemDetail` | standard-aligned, framework support | extension fields less type-safe |

Untuk API yang sangat besar dan contract-heavy, custom DTO yang kompatibel dengan Problem Details sering lebih nyaman. Untuk API yang ingin mengikuti Spring idiom modern, `ProblemDetail` sangat layak.

---

## 13. Validation Error Handling

Validation error adalah error paling sering, tetapi sering paling buruk desainnya.

### 13.1 Bad validation response

```json
{
  "message": "Validation failed"
}
```

Client tidak tahu field mana yang salah.

### 13.2 Better validation response

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "errors": [
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    },
    {
      "field": "dateOfBirth",
      "code": "MUST_BE_PAST_DATE",
      "message": "Date of birth must be in the past."
    }
  ]
}
```

### 13.3 Bean validation mapping example

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ApiErrorResponse> handleMethodArgumentNotValid(
        MethodArgumentNotValidException ex,
        HttpServletRequest request
) {
    List<ApiErrorResponse.FieldErrorItem> fieldErrors = ex.getBindingResult()
        .getFieldErrors()
        .stream()
        .map(error -> new ApiErrorResponse.FieldErrorItem(
            error.getField(),
            mapValidationCode(error.getCode()),
            safeValidationMessage(error)
        ))
        .toList();

    ApiErrorResponse body = new ApiErrorResponse(
        "https://api.example.com/problems/validation-error",
        "Validation failed",
        400,
        "One or more fields are invalid.",
        request.getRequestURI(),
        "VALIDATION_FAILED",
        correlationIdProvider.currentId(),
        traceIdProvider.currentTraceIdOrNull(),
        OffsetDateTime.now(),
        false,
        fieldErrors
    );

    return ResponseEntity.badRequest().body(body);
}
```

### 13.4 Validation code mapping

Bean Validation codes seperti `NotNull`, `Size`, `Pattern` bisa terlalu Java/framework-specific.

Mapping:

| Bean Validation | Public Code |
|---|---|
| `NotNull` | `REQUIRED` |
| `NotBlank` | `REQUIRED` |
| `Size` | `INVALID_LENGTH` |
| `Email` | `EMAIL_INVALID` |
| `Pattern` | `INVALID_FORMAT` |
| `Min` | `VALUE_TOO_SMALL` |
| `Max` | `VALUE_TOO_LARGE` |
| custom constraint | domain-specific code |

---

## 14. Domain Error Response

Domain error terjadi ketika request secara teknis valid, tetapi melanggar aturan bisnis atau state machine.

Contoh:

```text
Application cannot be submitted because declaration is incomplete.
```

Bisa dimodelkan sebagai:

```json
{
  "type": "https://api.example.com/problems/domain-rule-violation",
  "title": "Domain rule violation",
  "status": 422,
  "detail": "Application cannot be submitted because the declaration section is incomplete.",
  "code": "APPLICATION_DECLARATION_INCOMPLETE",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": false
}
```

Atau jika organisasi tidak memakai 422:

```json
{
  "type": "https://api.example.com/problems/resource-conflict",
  "title": "Resource conflict",
  "status": 409,
  "detail": "Application cannot be submitted from the current state.",
  "code": "APPLICATION_INVALID_STATE_FOR_SUBMISSION",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": false
}
```

Decision rule:

| Situation | Better Status |
|---|---:|
| Payload field invalid | 400 |
| Command valid but violates domain rule | 422 or 409 |
| Resource state prevents operation | 409 |
| Duplicate identity/resource | 409 |
| Missing resource | 404 |
| Caller lacks permission | 403 |

---

## 15. Dependency Error Response

External dependency failure harus diterjemahkan dengan hati-hati.

### 15.1 Jangan expose provider internals

Buruk:

```json
{
  "detail": "java.net.SocketTimeoutException: Read timed out calling https://provider.internal/api/v1/token"
}
```

Baik:

```json
{
  "type": "https://api.example.com/problems/dependency-timeout",
  "title": "Dependency timeout",
  "status": 504,
  "detail": "The address validation provider did not respond in time.",
  "code": "ADDRESS_PROVIDER_TIMEOUT",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true
}
```

### 15.2 Dependency taxonomy

| Internal Failure | Public Status | Code |
|---|---:|---|
| connection timeout | 504 | `DEPENDENCY_TIMEOUT` |
| read timeout | 504 | `DEPENDENCY_TIMEOUT` |
| DNS failure | 503 | `DEPENDENCY_UNAVAILABLE` |
| provider 429 | 503 or 429 depending boundary | `DEPENDENCY_RATE_LIMITED` |
| provider 401 due token expired | usually 503 after refresh failed | `DEPENDENCY_AUTH_FAILED` |
| provider bad schema | 502 | `DEPENDENCY_BAD_RESPONSE` |
| provider 5xx | 502/503 | `DEPENDENCY_UNAVAILABLE` |

### 15.3 Should you expose dependency name?

Depends.

For internal microservice APIs, useful:

```json
"dependency": "address-provider"
```

For public APIs, maybe too revealing. Use generic detail:

```json
"detail": "A required external provider is temporarily unavailable."
```

---

## 16. Idempotency Error Contract

Idempotency needs precise error semantics.

### 16.1 Same key, same request, previous success

Return same successful result if possible.

### 16.2 Same key, different request

Return conflict:

```json
{
  "type": "https://api.example.com/problems/idempotency-conflict",
  "title": "Idempotency conflict",
  "status": 409,
  "detail": "The idempotency key was already used with a different request payload.",
  "code": "IDEMPOTENCY_KEY_CONFLICT",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": false
}
```

### 16.3 Request still processing

Options:

- return `409 Conflict`;
- return `202 Accepted` with status resource;
- return `425 Too Early` in specific protocols;
- return `503` if transient lock.

For most enterprise APIs:

```json
{
  "type": "https://api.example.com/problems/request-in-progress",
  "title": "Request in progress",
  "status": 409,
  "detail": "A request with the same idempotency key is still being processed.",
  "code": "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true,
  "retryAfterSeconds": 2
}
```

---

## 17. Error Response During Graceful Shutdown

Karena seri ini juga membahas graceful shutdown, error contract perlu mendukung draining state.

Saat service mulai shutdown:

1. readiness menjadi false;
2. new requests ideally tidak masuk;
3. tetapi race tetap mungkin;
4. request baru yang terlanjur masuk harus ditolak dengan jelas;
5. in-flight request boleh diselesaikan jika budget cukup.

Response untuk request baru saat draining:

```json
{
  "type": "https://api.example.com/problems/service-draining",
  "title": "Service is draining",
  "status": 503,
  "detail": "The service instance is shutting down and cannot accept new work. Retry on another instance.",
  "code": "SERVICE_DRAINING",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "retryable": true
}
```

Important:

- do not return 500;
- do not accept new mutating work when shutdown deadline cannot guarantee completion;
- include retry hint if safe;
- ensure load balancer/client can retry another instance;
- mutating requests still require idempotency to avoid duplicate side effect.

---

## 18. Error Contract for Batch APIs

Batch API introduces partial failure.

Example request:

```json
{
  "items": [
    { "id": "A", "quantity": 2 },
    { "id": "B", "quantity": -1 },
    { "id": "C", "quantity": 5 }
  ]
}
```

Possible strategies:

### 18.1 All-or-nothing

If one item invalid, whole request fails:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more items are invalid.",
  "code": "VALIDATION_FAILED",
  "errors": [
    {
      "field": "items[1].quantity",
      "code": "VALUE_TOO_SMALL",
      "message": "Quantity must be at least 1."
    }
  ]
}
```

### 18.2 Partial success

Return 207 Multi-Status? Some systems use it, but many JSON APIs avoid 207 unless WebDAV semantics are accepted by organization.

Alternative: return 200/202 with per-item result if partial processing is expected behavior.

```json
{
  "batchId": "BATCH-2026-001",
  "status": "PARTIALLY_ACCEPTED",
  "results": [
    { "itemId": "A", "status": "ACCEPTED" },
    {
      "itemId": "B",
      "status": "REJECTED",
      "error": {
        "code": "VALUE_TOO_SMALL",
        "message": "Quantity must be at least 1."
      }
    }
  ]
}
```

Design choice:

- if partial success is business-normal, model it in success response;
- if partial success is unexpected, fail the whole command;
- avoid pretending partial failure is full success.

---

## 19. Error Contract for Async APIs

For async command:

```http
POST /applications/APP-1/submission
```

Response:

```http
202 Accepted
Location: /operations/OP-123
```

Later:

```http
GET /operations/OP-123
```

Failed operation response:

```json
{
  "operationId": "OP-123",
  "status": "FAILED",
  "error": {
    "type": "https://api.example.com/problems/domain-rule-violation",
    "title": "Domain rule violation",
    "status": 422,
    "detail": "Application cannot be submitted because declaration is incomplete.",
    "code": "APPLICATION_DECLARATION_INCOMPLETE",
    "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
    "retryable": false
  }
}
```

Key principle:

> Async failure still needs same error semantics. Do not reduce it to `FAILED` without reason code.

---

## 20. Backward Compatibility Rules

Error contract compatibility is often neglected.

### 20.1 Safe changes

Usually safe:

- add optional field;
- add new error code for new scenario;
- add new problem type for new endpoint;
- improve human-readable message without changing code semantics;
- add documentation URL.

### 20.2 Risky changes

Risky or breaking:

- changing `code` meaning;
- changing HTTP status for existing scenario;
- removing field;
- renaming field;
- changing field type;
- changing `errors[].field` path convention;
- changing `retryable` semantics;
- changing auth error from 401 to 403 without coordination;
- changing conflict from 409 to 400 if client logic depends on it.

### 20.3 Versioning strategy

Options:

1. API major version:

```text
/api/v2/applications
```

2. Media type version:

```text
application/problem+json;v=2
```

3. Additive evolution only for long-lived APIs.

For internal enterprise systems, additive evolution plus contract tests is often practical.

---

## 21. Error Documentation

Every stable error code should be documented.

Example table:

| Code | HTTP | Type | Retryable | Meaning | Client Action |
|---|---:|---|---:|---|---|
| `VALIDATION_FAILED` | 400 | validation-error | false | Request fields invalid | Fix fields and resubmit |
| `APPLICATION_NOT_FOUND` | 404 | resource-not-found | false | Application does not exist or not visible | Check ID/access |
| `APPLICATION_VERSION_CONFLICT` | 409 | resource-conflict | false | Resource modified concurrently | Refresh and retry |
| `RATE_LIMIT_EXCEEDED` | 429 | rate-limit-exceeded | true | Too many requests | Retry after delay |
| `DEPENDENCY_TIMEOUT` | 504 | dependency-timeout | true | External dependency timed out | Retry with backoff if idempotent |
| `SERVICE_DRAINING` | 503 | service-draining | true | Instance shutting down | Retry another instance |
| `INTERNAL_SERVER_ERROR` | 500 | internal-server-error | false | Unexpected server failure | Contact support with correlation ID |

Documentation should include:

- sample payload;
- when it occurs;
- client remediation;
- retry guidance;
- support guidance;
- whether user-facing;
- whether it counts as SLO error.

---

## 22. Error Metrics and SLO Relationship

Not all error responses mean service unreliability.

Examples:

| Error | Counts against service SLO? |
|---|---:|
| validation failed due client input | usually no |
| auth failed | usually no, unless auth service broken |
| not found due bad ID | usually no |
| conflict due concurrent update | usually no, maybe product friction metric |
| rate limited by system policy | maybe no, but track separately |
| dependency timeout | yes |
| internal server error | yes |
| service draining during rolling deploy | maybe no if retried transparently; yes if user-visible failure |

This distinction matters because reliability metrics should reflect user-impacting failure, not expected client mistakes.

Metrics labels:

```text
api_errors_total{code="VALIDATION_FAILED",status="400",endpoint="/applications"}
api_errors_total{code="DEPENDENCY_TIMEOUT",status="504",dependency="onemap"}
api_errors_total{code="INTERNAL_SERVER_ERROR",status="500"}
```

Avoid high cardinality labels:

Bad:

```text
api_errors_total{detail="Application APP-123 failed because..."}
```

Good:

```text
api_errors_total{code="APPLICATION_VERSION_CONFLICT"}
```

---

## 23. Anti-Patterns

### 23.1 Always return 200

Buruk:

```json
{
  "success": false,
  "error": "Validation failed"
}
```

Dengan HTTP 200.

Dampak:

- proxies/clients salah menganggap sukses;
- monitoring salah;
- retry logic rusak;
- API semantics kabur.

Exception: beberapa legacy RPC-style APIs melakukan ini, tetapi untuk REST/HTTP modern sebaiknya dihindari.

---

### 23.2 All errors are 500

Dampak:

- client salah retry validation error;
- monitoring noisy;
- incident false positive;
- domain semantics hilang.

---

### 23.3 Expose raw exception message

Buruk:

```java
return Map.of("message", ex.getMessage());
```

Karena `ex.getMessage()` sering berisi internal detail.

---

### 23.4 Client parses message string

Buruk:

```typescript
if (error.detail.includes("appeal window")) {
  showAppealClosedModal();
}
```

Harus pakai code:

```typescript
if (error.code === "APPEAL_WINDOW_CLOSED") {
  showAppealClosedModal();
}
```

---

### 23.5 Error code too generic

```text
BAD_REQUEST
BUSINESS_ERROR
SYSTEM_ERROR
```

Tidak cukup untuk automation, metrics, atau support.

---

### 23.6 Error code too specific

```text
APPLICATION_SUBMIT_CONTROLLER_LINE_238_NULL_DECLARATION_SECTION
```

Terlalu implementation-specific dan tidak stabil.

---

### 23.7 Leaking authorization policy

Membantu attacker memahami permission model.

---

### 23.8 Inconsistent field names

Endpoint A:

```json
{ "errorCode": "VALIDATION_FAILED" }
```

Endpoint B:

```json
{ "code": "VALIDATION_FAILED" }
```

Endpoint C:

```json
{ "err_code": "VALIDATION_FAILED" }
```

Ini memperlambat semua client dan testing.

---

### 23.9 No correlation ID

Saat user screenshot error, support tidak bisa cari log.

---

### 23.10 Retriable everything

Kalau semua error dianggap retryable, sistem bisa membuat retry storm.

---

## 24. Production Checklist

Gunakan checklist ini saat review API error contract.

### 24.1 Schema checklist

- [ ] Semua error memakai schema konsisten.
- [ ] Schema kompatibel dengan Problem Details atau punya alasan kuat.
- [ ] Ada `code` machine-readable.
- [ ] Ada `correlationId`.
- [ ] Ada `status` yang sesuai HTTP response.
- [ ] Ada `title` dan `detail` aman.
- [ ] Ada field-level errors untuk validation.
- [ ] Optional fields terdokumentasi.

### 24.2 Semantics checklist

- [ ] 400/401/403/404/409/422/429/500/503/504 dipakai konsisten.
- [ ] Domain rule violation tidak semua jadi 500.
- [ ] Dependency failure tidak bocor vendor internal.
- [ ] Conflict dibedakan dari validation.
- [ ] Retryable classification jelas.
- [ ] Idempotency error jelas.
- [ ] Shutdown/draining punya error code sendiri jika relevant.

### 24.3 Security checklist

- [ ] Tidak ada stack trace di response.
- [ ] Tidak ada SQL/table/internal hostname.
- [ ] Tidak ada token/secret.
- [ ] Tidak ada PII tidak perlu.
- [ ] Auth error tidak mempermudah enumeration.
- [ ] Correlation ID divalidasi.
- [ ] Error detail sesuai audience.

### 24.4 Operability checklist

- [ ] Error code muncul di log.
- [ ] Correlation ID muncul di log dan response.
- [ ] Trace ID tersedia jika tracing aktif.
- [ ] Metrics per error code/status.
- [ ] Runbook untuk critical errors.
- [ ] Support dapat menggunakan correlation ID.
- [ ] Alert hanya untuk error yang benar-benar operationally relevant.

### 24.5 Compatibility checklist

- [ ] Error codes didokumentasikan.
- [ ] Contract test mencakup error response.
- [ ] Unknown fields aman untuk client.
- [ ] Tidak mengubah meaning code lama.
- [ ] Deprecation policy ada.

---

## 25. Contract Testing for Errors

Error response harus dites seperti success response.

### 25.1 Example test idea

```java
@Test
void submitApplication_whenVersionConflict_returnsStableConflictError() throws Exception {
    mockMvc.perform(post("/api/applications/APP-1/submission")
            .header("If-Match", "old-version")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.type").value("https://api.example.com/problems/resource-conflict"))
        .andExpect(jsonPath("$.title").value("Resource conflict"))
        .andExpect(jsonPath("$.status").value(409))
        .andExpect(jsonPath("$.code").value("APPLICATION_VERSION_CONFLICT"))
        .andExpect(jsonPath("$.correlationId").exists())
        .andExpect(jsonPath("$.retryable").value(false));
}
```

### 25.2 Test what matters

Test stable fields:

- status;
- code;
- type;
- field error paths;
- retryable;
- correlation ID exists;
- no stack trace.

Avoid brittle tests on exact `detail` text unless detail is public contract.

### 25.3 Negative security test

```java
@Test
void unexpectedException_doesNotExposeStackTrace() throws Exception {
    mockMvc.perform(get("/api/test/unexpected-error"))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.code").value("INTERNAL_SERVER_ERROR"))
        .andExpect(jsonPath("$.trace").doesNotExist())
        .andExpect(jsonPath("$.detail").value(Matchers.not(Matchers.containsString("NullPointerException"))))
        .andExpect(jsonPath("$.detail").value(Matchers.not(Matchers.containsString("com.company"))));
}
```

---

## 26. Example End-to-End Mapping

Scenario:

Client calls:

```http
POST /api/applications/APP-2026-0001/submission
X-Correlation-Id: CLIENT-REQ-123
If-Match: v5
```

But current version is `v6`.

### 26.1 Domain detects conflict

```java
if (!command.expectedVersion().equals(application.version())) {
    throw new ApplicationVersionConflictException(application.id());
}
```

### 26.2 Exception handler maps to API error

```json
{
  "type": "https://api.example.com/problems/resource-conflict",
  "title": "Resource conflict",
  "status": 409,
  "detail": "The application was modified by another process. Refresh and try again.",
  "instance": "/api/applications/APP-2026-0001/submission",
  "code": "APPLICATION_VERSION_CONFLICT",
  "correlationId": "CLIENT-REQ-123",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp": "2026-06-15T10:12:31.099+07:00",
  "retryable": false
}
```

### 26.3 Log internally

```json
{
  "level": "WARN",
  "message": "Application version conflict",
  "code": "APPLICATION_VERSION_CONFLICT",
  "applicationId": "APP-2026-0001",
  "expectedVersion": "v5",
  "actualVersion": "v6",
  "correlationId": "CLIENT-REQ-123",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Note:

- response safe;
- log useful;
- code same;
- client can handle conflict;
- operator can search correlation ID.

---

## 27. Decision Matrix

| Failure Type | HTTP | Code Example | Retry? | Client Action | Operator Action |
|---|---:|---|---:|---|---|
| Malformed JSON | 400 | `MALFORMED_REQUEST` | No | Fix request | None |
| Field invalid | 400 | `VALIDATION_FAILED` | No | Fix fields | None |
| Missing auth | 401 | `AUTHENTICATION_REQUIRED` | After login/token refresh | Authenticate | Monitor auth spike |
| Access denied | 403 | `ACCESS_DENIED` | No | Request access | Investigate if unexpected |
| Not found | 404 | `APPLICATION_NOT_FOUND` | No | Check ID/access | None unless spike |
| Duplicate | 409 | `APPLICATION_ALREADY_EXISTS` | No | Use existing resource | None |
| Optimistic conflict | 409 | `APPLICATION_VERSION_CONFLICT` | After refresh | Refresh/rebase | Monitor UX/concurrency |
| Rate limited | 429 | `RATE_LIMIT_EXCEEDED` | Yes after delay | Backoff | Tune limits if needed |
| Dependency timeout | 504 | `ADDRESS_PROVIDER_TIMEOUT` | Yes if idempotent | Retry/backoff | Check dependency |
| Dependency unavailable | 503 | `DEPENDENCY_UNAVAILABLE` | Yes if idempotent | Retry/backoff | Incident/dependency |
| Service draining | 503 | `SERVICE_DRAINING` | Yes | Retry another instance | Check deploy/shutdown |
| Server bug | 500 | `INTERNAL_SERVER_ERROR` | Usually no blind retry | Contact support | Investigate immediately |

---

## 28. How Top-Tier Engineers Think About API Errors

A weaker engineer asks:

> “What status code should I return?”

A stronger engineer asks:

> “What decision must the caller make after receiving this error?”

A top-tier engineer asks:

> “What contract lets client, operator, support, monitoring, and future maintainers all classify and respond to this failure correctly without depending on implementation detail?”

Key heuristics:

1. **Every error should have a consumer decision.**
   If no one can act on the difference, maybe the code is too granular.

2. **Every public error code should be stable.**
   If you are not willing to document it, maybe do not expose it.

3. **Every 5xx should be suspicious.**
   5xx means the service failed to fulfill a valid request. Do not hide domain errors as 5xx.

4. **Every retry hint must be backed by idempotency reasoning.**
   Retry without idempotency can corrupt data.

5. **Every error response must be safe to screenshot.**
   Assume user will send it to support chat or email.

6. **Every operationally important error must be findable.**
   Correlation ID and log mapping are not optional.

7. **Every domain rejection should preserve business reason.**
   Especially in regulated systems, “bad request” is not enough evidence.

8. **Every error mapping should be tested.**
   Otherwise refactoring can silently break client behavior.

---

## 29. Common Java/Spring Failure Mapping Table

| Java/Spring Exception | Recommended Public Mapping |
|---|---|
| `MethodArgumentNotValidException` | 400 `VALIDATION_FAILED` |
| `ConstraintViolationException` | 400 `VALIDATION_FAILED` |
| `HttpMessageNotReadableException` | 400 `MALFORMED_REQUEST` |
| `MissingServletRequestParameterException` | 400 `MISSING_PARAMETER` |
| `NoHandlerFoundException` | 404 `RESOURCE_NOT_FOUND` or framework 404 |
| `AccessDeniedException` | 403 `ACCESS_DENIED` |
| `AuthenticationException` | 401 `AUTHENTICATION_REQUIRED` / `INVALID_TOKEN` |
| `OptimisticLockingFailureException` | 409 `RESOURCE_VERSION_CONFLICT` |
| `DuplicateKeyException` | 409 domain-specific duplicate code |
| `DataIntegrityViolationException` | 409 or 400 depending constraint semantics |
| `QueryTimeoutException` | 503/504 depending boundary |
| `CannotGetJdbcConnectionException` | 503 `DATABASE_UNAVAILABLE` |
| `SocketTimeoutException` calling dependency | 504 `DEPENDENCY_TIMEOUT` |
| `ConnectException` calling dependency | 503 `DEPENDENCY_UNAVAILABLE` |
| `IllegalArgumentException` | usually 500 unless intentionally mapped at boundary |
| `IllegalStateException` | usually 500 unless domain state exception exists |
| `NullPointerException` | 500 `INTERNAL_SERVER_ERROR` |

Important:

- Do not expose `IllegalArgumentException` from deep service as 400 automatically.
- At API boundary, invalid input should become validation exception.
- In domain layer, expected business failure should use domain exception.
- `IllegalStateException` often means bug/invariant breach unless explicitly modeled.

---

## 30. Practical Template

Use this as starting point for enterprise APIs.

### 30.1 Generic problem response

```json
{
  "type": "https://api.example.com/problems/{problem-type}",
  "title": "{stable-title}",
  "status": 400,
  "detail": "{safe-human-readable-detail}",
  "instance": "{request-path}",
  "code": "{STABLE_ERROR_CODE}",
  "correlationId": "{correlation-id}",
  "traceId": "{trace-id}",
  "timestamp": "{iso-8601-timestamp}",
  "retryable": false
}
```

### 30.2 Validation problem response

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/api/applications",
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "timestamp": "2026-06-15T10:12:31.099+07:00",
  "retryable": false,
  "errors": [
    {
      "field": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    }
  ]
}
```

### 30.3 Unexpected problem response

```json
{
  "type": "https://api.example.com/problems/internal-server-error",
  "title": "Internal server error",
  "status": 500,
  "detail": "An unexpected error occurred. Contact support with the correlation ID.",
  "instance": "/api/applications",
  "code": "INTERNAL_SERVER_ERROR",
  "correlationId": "01JZAB2SGE5FZ9R0VAD75K3P3W",
  "timestamp": "2026-06-15T10:12:31.099+07:00",
  "retryable": false
}
```

---

## 31. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman:

1. Mengapa `message` tidak boleh menjadi satu-satunya contract error?
2. Apa perbedaan HTTP status dan application error code?
3. Kapan 409 lebih tepat daripada 400?
4. Kapan 401 berbeda dari 403?
5. Mengapa stack trace tidak boleh muncul di response?
6. Mengapa `retryable=true` berbahaya tanpa idempotency?
7. Apa beda error response dan log entry?
8. Bagaimana correlation ID membantu incident response?
9. Kenapa domain rule violation perlu error code sendiri?
10. Apa perubahan error contract yang tergolong breaking change?
11. Bagaimana mendesain error untuk batch partial failure?
12. Bagaimana error response saat service sedang graceful shutdown/draining?
13. Mengapa client tidak boleh parsing `detail`?
14. Apa field minimal untuk validation error yang baik?
15. Bagaimana membedakan expected business error dari unexpected server bug?

---

## 32. Summary

API error contract adalah bagian inti dari reliability engineering.

Kesimpulan utama:

1. Error response adalah **public boundary contract**, bukan dump exception internal.
2. HTTP status memberi transport-level semantics; `code` memberi application/domain-level semantics.
3. Format Problem Details memberi baseline standar yang kuat untuk HTTP API.
4. Error code harus stabil, documented, machine-readable, dan testable.
5. Error response harus aman secara security: no stack trace, no SQL, no secret, no unnecessary PII.
6. Correlation ID adalah jembatan antara client-visible error dan operational evidence.
7. Retry hint harus didesain berdasarkan idempotency dan failure classification.
8. Validation error perlu field-level detail.
9. Domain error harus preserve business meaning, terutama untuk regulated workflows.
10. Error mapping harus dites seperti success contract.

Mental model penutup:

> Error contract yang baik membuat kegagalan menjadi terklasifikasi, aman, dapat ditindaklanjuti, dapat diamati, dan stabil untuk evolusi sistem.

---

## 33. Referensi

- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- Spring Framework Reference — Error Responses: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html
- Spring Framework Javadoc — `ResponseEntityExceptionHandler`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/mvc/method/annotation/ResponseEntityExceptionHandler.html
- OWASP Cheat Sheet Series — Error Handling: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- OWASP Cheat Sheet Series — REST Security: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- Google SRE Workbook — Error Budget Policy: https://sre.google/workbook/error-budget-policy/
- Google SRE Book — Service Level Objectives: https://sre.google/sre-book/service-level-objectives/

---

## 34. Status Seri

```text
Part 005 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 006 — Exception Translation Layers
```
