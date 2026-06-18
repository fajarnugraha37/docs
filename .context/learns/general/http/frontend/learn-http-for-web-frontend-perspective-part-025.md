# learn-http-for-web-frontend-perspective-part-025.md

# Part 025 — Error Contract Design: Making Failures Useful to Humans and Machines

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `025`  
> Perspektif: Frontend/browser-facing HTTP contract untuk Java software engineer  
> Fokus: status code, error envelope, validation error, retryability, localization, correlation, observability, security, dan UI state mapping

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita sudah membahas **mutation design**: idempotency, optimistic UI, conflict, long-running operation, dan concurrency. Semua topik itu akan runtuh kalau error contract tidak jelas.

Bagian ini membahas bagaimana mendesain error HTTP/API yang:

1. **benar secara protokol**;
2. **mudah dipahami frontend**;
3. **aman dari information disclosure**;
4. **berguna untuk user**;
5. **berguna untuk mesin**;
6. **berguna untuk support dan observability**;
7. **stabil untuk jangka panjang**;
8. **bisa dievolusi tanpa merusak client lama**.

Target akhirnya: ketika sebuah request gagal, frontend tidak hanya tahu “ada error”, tetapi bisa menjawab:

- apakah user harus login ulang?
- apakah user boleh retry?
- apakah field tertentu salah?
- apakah operasi konflik dengan data terbaru?
- apakah server sedang overload?
- apakah error harus tampil sebagai inline validation, toast, banner, full-page error, atau silent background failure?
- apakah error perlu dilaporkan ke telemetry?
- apakah support bisa menelusuri request itu dari correlation ID?
- apakah detail teknis aman untuk ditampilkan?

Error contract yang bagus bukan kosmetik. Ia adalah **control surface** untuk UX, reliability, security, supportability, dan operability.

---

## 1. Mental Model: Error adalah Outcome Contract, Bukan Sekadar Message

Banyak sistem memperlakukan error response seperti ini:

```json
{
  "message": "Something went wrong"
}
```

Itu tidak cukup.

Frontend membutuhkan lebih dari kalimat. Frontend membutuhkan **keputusan**.

Sebuah error response yang baik harus membantu client menentukan:

| Pertanyaan | Contoh Keputusan Frontend |
|---|---|
| Apa kelas kegagalannya? | auth, validation, conflict, rate limit, server error |
| Apakah request berhasil sebagian? | tampilkan partial result atau rollback |
| Apakah user bisa memperbaikinya? | highlight field, minta login, refresh data |
| Apakah retry aman? | retry otomatis, retry manual, jangan retry |
| Apakah pesan boleh ditampilkan? | tampilkan `userMessage` atau generic fallback |
| Apakah perlu telemetry? | capture error event dengan trace ID |
| Apakah support bisa melacak? | tampilkan support reference |
| Apakah client lama masih bisa memahami? | pakai field stabil dan backward-compatible |

Jadi error contract harus dipandang sebagai:

```text
HTTP status code
    + machine-readable type/code
    + human-safe message
    + retry/handling metadata
    + field/domain details
    + correlation metadata
    + stable evolution rules
```

Bukan hanya:

```text
status + message
```

---

## 2. Tiga Lapisan Error: Transport, HTTP, Domain

Frontend perlu membedakan tiga lapisan kegagalan.

### 2.1 Transport/Browser Error

Ini terjadi sebelum frontend menerima HTTP response yang valid.

Contoh:

- DNS failure.
- TLS error.
- connection refused.
- offline.
- CORS blocked.
- mixed content blocked.
- request aborted.
- timeout buatan client.
- browser policy blocked.

Dalam `fetch()`, banyak kasus ini muncul sebagai rejected promise atau opaque/blocking behavior, bukan sebagai `Response` dengan status code.

Contoh mental model:

```ts
try {
  const res = await fetch(url);
} catch (err) {
  // Tidak selalu berarti server mengembalikan 500.
  // Bisa DNS, CORS, TLS, offline, abort, atau browser policy.
}
```

**Invariant:** kalau tidak ada HTTP response yang bisa dibaca JavaScript, maka tidak ada status code dan tidak ada error body yang bisa diandalkan.

Frontend harus punya fallback handling untuk ini.

---

### 2.2 HTTP Protocol Outcome

Ini adalah status code yang dikirim server/gateway/CDN.

Contoh:

- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `412 Precondition Failed`
- `422 Unprocessable Content`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

Status code memberi **kelas outcome**.

Status code tidak harus mengandung semua detail domain, tetapi harus cukup benar untuk:

- observability;
- retries;
- caching behavior;
- gateway handling;
- monitoring;
- alerting;
- frontend branching.

Kesalahan umum:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "error": "Invalid input"
}
```

Masalahnya:

- monitoring melihatnya sebagai sukses;
- retry policy bisa salah;
- client harus parse body untuk tahu outcome;
- gateway/CDN tidak bisa memahami failure;
- analytics endpoint success rate menjadi bohong;
- browser/devtools memberi sinyal salah.

Gunakan status code sesuai semantic.

---

### 2.3 Domain/Application Error

Ini adalah detail spesifik bisnis.

Contoh:

- `CUSTOMER_ALREADY_EXISTS`
- `CASE_ALREADY_CLOSED`
- `PAYMENT_LIMIT_EXCEEDED`
- `DOCUMENT_REQUIRES_APPROVAL`
- `VERSION_CONFLICT`
- `INVALID_TRANSITION`
- `INSUFFICIENT_ROLE`

Domain error harus hidup di body, bukan menggantikan HTTP status.

Contoh:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/case-invalid-transition",
  "title": "Case transition is not allowed",
  "status": 409,
  "code": "CASE_INVALID_TRANSITION",
  "detail": "This case cannot move from CLOSED to IN_REVIEW.",
  "instance": "/cases/CASE-123/transitions/req-789"
}
```

HTTP status menjawab:

```text
kelas outcome: conflict
```

Domain code menjawab:

```text
conflict apa?
```

UI menjawab:

```text
apa yang harus user lihat/lakukan?
```

---

## 3. Problem Details: Format Standar Modern

Untuk error body, standar modern yang sangat berguna adalah **Problem Details for HTTP APIs**.

RFC 9457 mendefinisikan format `application/problem+json` untuk membawa detail error yang machine-readable dan menghindari setiap API membuat format error baru sendiri. RFC 9457 juga menggantikan RFC 7807.

Bentuk dasarnya:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/orders/requests/01HV..."
}
```

Field standar:

| Field | Makna |
|---|---|
| `type` | URI identifier untuk jenis problem |
| `title` | ringkasan pendek jenis problem |
| `status` | HTTP status code yang sesuai |
| `detail` | detail human-readable untuk occurrence ini |
| `instance` | URI/reference untuk occurrence spesifik |

Field tambahan boleh ditambahkan selama tidak merusak semantic.

Contoh extension yang umum:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "correlationId": "req-20260618-9f7a",
  "userMessage": "Please check the highlighted fields.",
  "errors": [
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    },
    {
      "field": "startDate",
      "code": "DATE_MUST_BE_IN_FUTURE",
      "message": "Start date must be in the future."
    }
  ]
}
```

### 3.1 Kenapa Jangan Hanya Menggunakan `message`

`message` biasanya kabur:

```json
{
  "message": "Invalid request"
}
```

Frontend tidak tahu:

- field mana salah;
- apakah bisa retry;
- apakah harus logout;
- apakah ini validasi user atau bug client;
- apakah pesan aman ditampilkan;
- apakah perlu telemetry;
- apakah ada trace ID.

Lebih baik pisahkan:

| Field | Konsumen Utama |
|---|---|
| `title` | developer, logs, fallback display |
| `detail` | developer/support, bukan selalu end-user |
| `userMessage` | end-user jika aman |
| `code` | frontend branching, analytics, test |
| `errors[]` | form UI |
| `traceId` / `correlationId` | observability/support |
| `retryAfter` / header `Retry-After` | retry orchestration |

---

## 4. Status Code Mapping untuk Frontend

Status code adalah sinyal pertama.

### 4.1 400 Bad Request

Gunakan untuk request yang tidak dapat dipahami atau tidak valid pada level umum.

Contoh:

- JSON malformed.
- query parameter invalid secara sintaks.
- enum tidak dikenal.
- request body tidak sesuai schema dasar.
- pagination parameter bukan angka.

Contoh response:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/bad-request",
  "title": "Bad request",
  "status": 400,
  "code": "BAD_REQUEST",
  "detail": "Parameter 'limit' must be an integer between 1 and 100."
}
```

Frontend handling:

- biasanya bukan retry otomatis;
- bisa tampilkan generic “Request is invalid”;
- log telemetry karena mungkin bug frontend;
- jika field-level, pertimbangkan `422` untuk semantic validation.

---

### 4.2 401 Unauthorized

Nama historisnya membingungkan. Dalam praktik HTTP modern, `401` berarti authentication diperlukan, gagal, atau credential tidak valid.

Gunakan untuk:

- belum login;
- access token expired;
- session expired;
- token invalid;
- missing credential.

Frontend handling:

- trigger auth recovery;
- refresh token jika flow mendukung;
- redirect ke login jika recovery gagal;
- jangan tampilkan “you do not have permission” karena itu lebih cocok `403`;
- hati-hati refresh-token stampede.

Contoh:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json
WWW-Authenticate: Bearer error="invalid_token"

{
  "type": "https://api.example.com/problems/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "code": "AUTHENTICATION_REQUIRED",
  "userMessage": "Please sign in again."
}
```

---

### 4.3 403 Forbidden

Gunakan ketika user terautentikasi, tetapi tidak memiliki izin untuk aksi/resource itu.

Contoh:

- role tidak cukup;
- policy melarang akses;
- tenant mismatch;
- account suspended;
- action not allowed for current user.

Frontend handling:

- jangan auto-login ulang;
- tampilkan forbidden/permission message;
- mungkin sembunyikan action di UI ke depan;
- telemetry sebagai authorization event;
- untuk security, jangan terlalu detail jika detail bisa membocorkan resource.

Contoh:

```json
{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "INSUFFICIENT_PERMISSION",
  "userMessage": "You do not have permission to perform this action."
}
```

---

### 4.4 404 Not Found

Gunakan ketika target resource tidak ditemukan atau sengaja disembunyikan.

Contoh:

- case ID tidak ada;
- document sudah dihapus;
- resource ada tetapi tidak boleh diketahui user tertentu.

Frontend handling:

- route-level not found;
- stale link handling;
- refresh list;
- jangan retry otomatis;
- bedakan 404 resource utama vs 404 subresource optional.

Contoh:

```json
{
  "type": "https://api.example.com/problems/resource-not-found",
  "title": "Resource not found",
  "status": 404,
  "code": "CASE_NOT_FOUND",
  "userMessage": "The case could not be found. It may have been deleted or you may no longer have access."
}
```

---

### 4.5 409 Conflict

Gunakan ketika request valid secara bentuk, tetapi konflik dengan state resource saat ini.

Contoh:

- duplicate unique key;
- invalid state transition;
- resource already exists;
- operation conflicts with current workflow state;
- concurrent modification.

Frontend handling:

- refresh data;
- show conflict resolution UI;
- rollback optimistic update;
- jangan retry buta;
- berikan aksi user: reload, review changes, merge, choose another value.

Contoh:

```json
{
  "type": "https://api.example.com/problems/state-conflict",
  "title": "State conflict",
  "status": 409,
  "code": "CASE_ALREADY_CLOSED",
  "userMessage": "This case has already been closed by another user.",
  "currentState": "CLOSED"
}
```

---

### 4.6 412 Precondition Failed

Gunakan ketika client mengirim precondition seperti `If-Match`, tetapi validator tidak cocok.

Contoh:

```http
PUT /cases/CASE-123
If-Match: "v7"
```

Server menemukan resource sudah di versi `v8`, maka:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "code": "VERSION_MISMATCH",
  "userMessage": "This item has changed since you opened it. Refresh and review the latest version before saving.",
  "expectedVersion": "v7",
  "actualVersion": "v8"
}
```

Frontend handling:

- do not overwrite;
- fetch latest representation;
- show merge/review UI;
- preserve unsaved user input if possible.

---

### 4.7 422 Unprocessable Content

Gunakan untuk request yang syntactically valid, tetapi gagal validasi domain/semantic.

Contoh:

- email format invalid;
- date range invalid;
- required business field missing;
- amount exceeds allowed limit;
- invalid combination of fields.

Frontend handling:

- show inline field errors;
- focus first invalid field;
- preserve user input;
- no retry automatic;
- treat as user-correctable.

Contoh:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "userMessage": "Please fix the highlighted fields.",
  "errors": [
    {
      "field": "period.startDate",
      "code": "DATE_MUST_BE_BEFORE_END_DATE",
      "message": "Start date must be before end date."
    },
    {
      "field": "assigneeId",
      "code": "ASSIGNEE_NOT_ELIGIBLE",
      "message": "Selected assignee is not eligible for this case type."
    }
  ]
}
```

---

### 4.8 429 Too Many Requests

Gunakan untuk rate limiting.

Frontend handling:

- respect `Retry-After` jika ada;
- stop aggressive retry;
- show throttling message;
- degrade interaction;
- disable submit temporarily;
- use backoff + jitter.

Contoh:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 30

{
  "type": "https://api.example.com/problems/rate-limited",
  "title": "Rate limit exceeded",
  "status": 429,
  "code": "RATE_LIMITED",
  "userMessage": "Too many attempts. Please try again shortly.",
  "retryAfterSeconds": 30
}
```

Catatan: header `Retry-After` adalah sinyal protokol. Field body seperti `retryAfterSeconds` boleh membantu UI, tetapi header tetap penting untuk client/gateway/tooling.

---

### 4.9 500 Internal Server Error

Gunakan untuk unexpected server failure.

Frontend handling:

- jangan tampilkan detail internal;
- show generic error;
- allow manual retry jika operation safe atau idempotent;
- capture telemetry;
- display support reference jika ada;
- untuk mutation, jangan otomatis assume gagal total tanpa idempotency/operation status.

Contoh:

```json
{
  "type": "https://api.example.com/problems/internal-server-error",
  "title": "Internal server error",
  "status": 500,
  "code": "INTERNAL_ERROR",
  "userMessage": "Something went wrong. Please try again later.",
  "supportReference": "SUP-20260618-8HD2",
  "correlationId": "req-9f7a"
}
```

Jangan kirim:

```json
{
  "exception": "java.lang.NullPointerException",
  "stackTrace": "com.example.CaseService.close(CaseService.java:431)...",
  "sql": "select * from users where ..."
}
```

Detail seperti itu harus masuk logs/tracing, bukan response publik.

---

### 4.10 502, 503, 504 Gateway/Availability Errors

Frontend sering menerima error bukan dari aplikasi, tetapi dari gateway, reverse proxy, CDN, load balancer, atau ingress.

| Status | Makna Praktis |
|---|---|
| `502 Bad Gateway` | upstream memberi response invalid/error |
| `503 Service Unavailable` | service tidak siap/overload/maintenance |
| `504 Gateway Timeout` | gateway timeout menunggu upstream |

Frontend handling:

- show service unavailable / retry later;
- consider automatic retry hanya untuk safe/idempotent request;
- for mutation, gunakan idempotency key/status polling;
- log gateway-specific telemetry;
- jangan assume backend business logic menolak request.

Contoh `503`:

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/problem+json
Retry-After: 120

{
  "type": "https://api.example.com/problems/service-unavailable",
  "title": "Service unavailable",
  "status": 503,
  "code": "SERVICE_UNAVAILABLE",
  "userMessage": "The service is temporarily unavailable. Please try again in a few minutes.",
  "retryAfterSeconds": 120
}
```

---

## 5. Error Envelope yang Direkomendasikan

Untuk enterprise/API modern, gunakan Problem Details sebagai basis dan tambahkan extension field dengan disiplin.

Contoh canonical envelope:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/requests/01HVZ7S9E3F8P4A2",
  "code": "VALIDATION_FAILED",
  "userMessage": "Please fix the highlighted fields.",
  "severity": "ERROR",
  "retryable": false,
  "correlationId": "req-20260618-9f7a",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": [
    {
      "field": "customer.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid.",
      "rejectedValue": "not-an-email"
    }
  ]
}
```

### 5.1 Field Contract

| Field | Required? | Stabil? | Catatan |
|---|---:|---:|---|
| `type` | yes | yes | problem type URI; jangan berubah sembarangan |
| `title` | yes | mostly | ringkasan untuk developer/fallback |
| `status` | yes | yes | harus cocok dengan HTTP status |
| `detail` | optional | no | detail occurrence; jangan dipakai untuk branching |
| `instance` | optional | no | occurrence/request reference |
| `code` | recommended | yes | machine-readable domain/API code |
| `userMessage` | optional | no | aman untuk user; bisa dilokalisasi |
| `errors[]` | optional | schema stable | field/domain validation details |
| `correlationId` | recommended | no | support/log lookup |
| `traceId` | recommended | no | distributed tracing |
| `retryable` | optional | yes-ish | hati-hati; harus konsisten dengan method/idempotency |
| `retryAfterSeconds` | optional | no | duplikasi UI-friendly dari `Retry-After` |
| `supportReference` | optional | no | public-safe reference |

### 5.2 Jangan Branching Berdasarkan `detail` atau `message`

Buruk:

```ts
if (error.message.includes("already closed")) {
  showCaseClosedDialog();
}
```

Baik:

```ts
if (error.code === "CASE_ALREADY_CLOSED") {
  showCaseClosedDialog();
}
```

`message/detail/userMessage` bisa berubah karena wording, localization, atau legal review. `code` harus stabil.

---

## 6. Validation Error Design

Validation error adalah jenis error paling sering terlihat user.

Desain yang buruk:

```json
{
  "message": "Invalid input"
}
```

Desain yang lebih baik:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "userMessage": "Please fix the highlighted fields.",
  "errors": [
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "Enter a valid email address."
    },
    {
      "field": "password",
      "code": "PASSWORD_TOO_SHORT",
      "message": "Password must contain at least 12 characters.",
      "minLength": 12
    }
  ]
}
```

### 6.1 Field Path Convention

Tentukan format field path.

Pilihan umum:

```text
email
customer.email
items[0].quantity
addresses[2].postalCode
```

Atau JSON Pointer:

```text
/customer/email
/items/0/quantity
/addresses/2/postalCode
```

Yang penting:

- konsisten;
- bisa dipetakan ke form field;
- stabil terhadap nested object;
- tidak bergantung pada label UI;
- tidak memakai localized name.

### 6.2 Field Error vs Object Error

Tidak semua validation error melekat pada satu field.

Contoh field-level:

```json
{
  "field": "email",
  "code": "EMAIL_INVALID",
  "message": "Enter a valid email address."
}
```

Contoh object-level:

```json
{
  "field": null,
  "code": "DATE_RANGE_OVERLAPS_EXISTING_CASE",
  "message": "The selected period overlaps with an existing case."
}
```

Atau:

```json
{
  "scope": "FORM",
  "code": "AT_LEAST_ONE_APPROVER_REQUIRED",
  "message": "At least one approver is required."
}
```

Frontend harus punya area untuk:

- inline field errors;
- form-level errors;
- page-level errors.

### 6.3 Rejected Value: Hati-Hati PII

`rejectedValue` kadang berguna untuk debugging, tetapi bisa membocorkan data sensitif.

Aman untuk:

```json
{
  "field": "quantity",
  "rejectedValue": -3
}
```

Berisiko untuk:

```json
{
  "field": "password",
  "rejectedValue": "MySecretPassword123"
}
```

Aturan praktis:

- jangan kirim rejected value untuk password, token, secret, document content, PII sensitif;
- boleh kirim untuk value non-sensitive jika membantu UI;
- gunakan redaction/masking kalau perlu.

---

## 7. Domain Error Code Taxonomy

Agar frontend stabil, domain error code harus didesain seperti API contract.

### 7.1 Struktur Code

Contoh struktur:

```text
VALIDATION_FAILED
AUTHENTICATION_REQUIRED
INSUFFICIENT_PERMISSION
RESOURCE_NOT_FOUND
CASE_ALREADY_CLOSED
CASE_INVALID_TRANSITION
VERSION_MISMATCH
RATE_LIMITED
SERVICE_UNAVAILABLE
```

Atau namespace:

```text
AUTH.AUTHENTICATION_REQUIRED
AUTH.INSUFFICIENT_PERMISSION
CASE.ALREADY_CLOSED
CASE.INVALID_TRANSITION
CASE.VERSION_MISMATCH
VALIDATION.FIELD_INVALID
RATE_LIMIT.EXCEEDED
```

Pilih salah satu dan konsisten.

### 7.2 Code Harus Stabil

Jangan ubah code hanya karena wording berubah.

Buruk:

```text
OLD: CASE_ALREADY_CLOSED
NEW: CANNOT_CLOSE_CLOSED_CASE
```

Kalau client sudah branching pada `CASE_ALREADY_CLOSED`, perubahan ini breaking.

Jika perlu evolusi:

- tambahkan code baru untuk semantic baru;
- pertahankan code lama selama masa transisi;
- dokumentasikan deprecation;
- gunakan contract tests.

### 7.3 Jangan Terlalu Banyak Code yang Tidak Punya Behavior Berbeda

Kalau semua error ditangani frontend dengan cara sama, terlalu banyak code bisa menjadi noise.

Pertanyaan desain:

```text
Apakah frontend akan melakukan sesuatu yang berbeda untuk code ini?
Apakah analytics/support perlu membedakannya?
Apakah policy/audit perlu membedakannya?
```

Jika tidak, code generic cukup.

---

## 8. Retryability: Jangan Sederhanakan Berlebihan

Banyak API menambahkan field:

```json
{
  "retryable": true
}
```

Ini berguna, tapi berbahaya jika tidak memahami method dan operation semantics.

### 8.1 Retryability Bergantung pada Banyak Hal

Retry aman atau tidak bergantung pada:

- HTTP method;
- idempotency;
- apakah request sudah sampai server;
- apakah mutation punya idempotency key;
- apakah operasi long-running;
- status code;
- `Retry-After`;
- business side effect;
- client timeout vs server timeout;
- apakah duplicate execution berbahaya.

Contoh:

| Request | Status | Retry Otomatis? | Catatan |
|---|---:|---|---|
| `GET /cases` | `503` | mungkin ya | safe method |
| `POST /payments` tanpa idempotency key | timeout | tidak otomatis | risiko double charge |
| `POST /payments` dengan idempotency key | timeout | bisa dengan hati-hati | server harus dedupe |
| `PUT /profile` | `502` | mungkin | idempotent jika body sama |
| `PATCH /case` | `409` | tidak | perlu user resolution |
| `POST /login` | `429` | tidak sampai Retry-After | rate limit |

### 8.2 Prefer Protocol Signal untuk Rate Limit/Unavailable

Untuk `429` dan `503`, gunakan header:

```http
Retry-After: 60
```

Body boleh menyertakan metadata UI:

```json
{
  "code": "RATE_LIMITED",
  "retryAfterSeconds": 60,
  "userMessage": "Too many attempts. Try again in one minute."
}
```

### 8.3 Retry Policy Harus Ada di Client Layer, Bukan Komponen UI Tersebar

Buruk:

```ts
// Di banyak komponen berbeda
tryAgain();
setTimeout(() => submit(), 1000);
```

Baik:

```ts
httpClient.request({
  method: "GET",
  url: "/cases",
  retryPolicy: "safe-read"
});
```

Atau dengan abstraction data fetching:

```ts
useQuery({
  queryKey: ["cases"],
  queryFn: fetchCases,
  retry: (failureCount, error) => isRetryableReadError(error) && failureCount < 3
});
```

---

## 9. User Message vs Developer Detail

Pisahkan pesan untuk user dan detail untuk developer/support.

### 9.1 `userMessage`

Karakteristik:

- aman ditampilkan;
- tidak membocorkan internal;
- tidak menyalahkan user secara agresif;
- bisa dilokalisasi;
- cukup actionable.

Contoh:

```json
{
  "userMessage": "This case has changed since you opened it. Refresh to see the latest version."
}
```

### 9.2 `detail`

Karakteristik:

- menjelaskan occurrence lebih teknis;
- masih tidak boleh membocorkan secret/stack trace;
- berguna untuk developer/support;
- tidak digunakan untuk branching.

Contoh:

```json
{
  "detail": "If-Match validator \"v7\" did not match current validator \"v8\"."
}
```

### 9.3 Jangan Kirim Internal Exception Message ke User

Buruk:

```json
{
  "message": "could not execute statement; SQL constraint FK_case_user failed"
}
```

Baik:

```json
{
  "code": "ASSIGNEE_NOT_FOUND",
  "userMessage": "The selected assignee is no longer available.",
  "correlationId": "req-9f7a"
}
```

Internal detail tetap ada di log/tracing.

---

## 10. Localization Strategy

Ada dua pendekatan utama.

### 10.1 Server Mengirim Localized Message

Request:

```http
Accept-Language: id-ID,id;q=0.9,en;q=0.8
```

Response:

```json
{
  "code": "CASE_ALREADY_CLOSED",
  "userMessage": "Kasus ini sudah ditutup oleh pengguna lain."
}
```

Kelebihan:

- server mengontrol wording;
- konsisten lintas client;
- bisa mengikuti domain/legal wording.

Kekurangan:

- perlu localization backend;
- cache harus mempertimbangkan `Vary: Accept-Language` jika response cacheable;
- frontend sulit melakukan dynamic interpolation dengan gaya UI sendiri.

### 10.2 Server Mengirim Code, Frontend Menerjemahkan

Response:

```json
{
  "code": "CASE_ALREADY_CLOSED",
  "messageParams": {
    "caseId": "CASE-123"
  }
}
```

Frontend:

```ts
t("errors.CASE_ALREADY_CLOSED", { caseId });
```

Kelebihan:

- frontend mengontrol UX wording;
- mudah integrasi dengan frontend i18n;
- cache lebih mudah.

Kekurangan:

- semua client harus sinkron translation key;
- domain/legal message bisa divergen;
- mobile/web version lama bisa kehilangan terjemahan.

### 10.3 Rekomendasi Praktis

Untuk enterprise web app:

- selalu kirim `code` stabil;
- boleh kirim `userMessage` sebagai fallback;
- frontend boleh override localization berdasarkan `code`;
- untuk validation field, `message` boleh dikirim dari server tapi jangan dipakai untuk branching;
- dokumentasikan apakah `userMessage` authoritative atau fallback.

---

## 11. Correlation ID, Trace ID, and Support Reference

Error tanpa traceability adalah mimpi buruk support.

### 11.1 Correlation ID

`correlationId` biasanya satu ID untuk menghubungkan request/log/event dalam sistem.

Header:

```http
X-Correlation-ID: req-20260618-9f7a
```

Response body:

```json
{
  "correlationId": "req-20260618-9f7a"
}
```

Frontend dapat:

- kirim di telemetry;
- tampilkan sebagai “support reference”;
- lampirkan saat user melapor;
- hubungkan browser error dengan server log.

### 11.2 Trace ID

Untuk distributed tracing modern, sering digunakan W3C Trace Context:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Di body:

```json
{
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Gunakan dengan hati-hati:

- jangan expose internal topology;
- ID saja biasanya aman;
- detail span/service tidak perlu dikirim ke client.

### 11.3 Support Reference

Untuk user-facing app, lebih baik tampilkan reference yang ramah:

```text
Something went wrong. Reference: SUP-20260618-8HD2
```

Daripada:

```text
traceId=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Support reference bisa memetakan ke correlation/trace ID internal.

---

## 12. Security: Error Message sebagai Attack Surface

Error response dapat membocorkan:

- stack trace;
- framework/library version;
- SQL query;
- table/column name;
- file path;
- tenant ID;
- user existence;
- permission model;
- token format;
- internal service names;
- business rule sensitif.

### 12.1 User Enumeration

Contoh buruk login/forgot password:

```json
{
  "code": "EMAIL_NOT_REGISTERED",
  "userMessage": "No account exists for this email."
}
```

Untuk flow tertentu, ini bisa memungkinkan attacker mengetahui email mana yang terdaftar.

Lebih aman:

```json
{
  "code": "RESET_EMAIL_ACCEPTED",
  "userMessage": "If an account exists for this email, we will send reset instructions."
}
```

Untuk login:

```json
{
  "code": "INVALID_CREDENTIALS",
  "userMessage": "Invalid email or password."
}
```

### 12.2 Authorization Detail Leakage

Buruk:

```json
{
  "code": "TENANT_MISMATCH",
  "detail": "Case CASE-123 belongs to tenant BANK-ALPHA, not BANK-BETA."
}
```

Lebih aman:

```json
{
  "code": "RESOURCE_NOT_FOUND",
  "userMessage": "The requested resource could not be found."
}
```

Kadang `404` lebih aman daripada `403` jika eksistensi resource tidak boleh diketahui.

### 12.3 Stack Trace Leakage

Tidak boleh:

```json
{
  "exception": "org.postgresql.util.PSQLException",
  "message": "ERROR: duplicate key value violates unique constraint users_email_key",
  "stackTrace": "..."
}
```

Boleh:

```json
{
  "code": "EMAIL_ALREADY_USED",
  "userMessage": "This email address is already in use.",
  "correlationId": "req-9f7a"
}
```

---

## 13. UI Mapping: Error Contract ke User Experience

Frontend harus punya mapping eksplisit dari error ke UI.

### 13.1 UI Surfaces

| Surface | Cocok Untuk |
|---|---|
| Inline field error | validation field-level |
| Form-level error | validation cross-field, business rule |
| Toast | non-blocking action failure/success |
| Banner | page-wide recoverable issue |
| Modal | destructive/conflict decision |
| Full-page error | resource not found, forbidden, fatal page load |
| Silent/log only | background refresh failed, telemetry-only |
| Retry panel | temporary unavailable/network issue |
| Auth redirect | 401 unrecoverable |

### 13.2 Mapping Example

```ts
type UiErrorAction =
  | { kind: "inline-validation"; fields: FieldError[] }
  | { kind: "auth-redirect" }
  | { kind: "forbidden-page" }
  | { kind: "not-found-page" }
  | { kind: "conflict-dialog"; code: string }
  | { kind: "rate-limit-banner"; retryAfterSeconds?: number }
  | { kind: "generic-error"; supportReference?: string };
```

Mapping:

```ts
function mapApiErrorToUi(error: ApiError): UiErrorAction {
  switch (error.status) {
    case 401:
      return { kind: "auth-redirect" };
    case 403:
      return { kind: "forbidden-page" };
    case 404:
      return { kind: "not-found-page" };
    case 409:
      return { kind: "conflict-dialog", code: error.code };
    case 422:
      return { kind: "inline-validation", fields: error.errors ?? [] };
    case 429:
      return { kind: "rate-limit-banner", retryAfterSeconds: error.retryAfterSeconds };
    default:
      return { kind: "generic-error", supportReference: error.supportReference };
  }
}
```

### 13.3 Jangan Semua Error Jadi Toast

Toast adalah surface yang sering disalahgunakan.

Buruk:

```text
Toast: Failed
```

Untuk validation, toast buruk karena:

- hilang sendiri;
- tidak melekat pada field;
- tidak accessible;
- user tidak tahu bagian mana salah.

Untuk page load fatal, toast buruk karena:

- konten utama tetap kosong;
- tidak memberi recovery path;
- sulit untuk screen reader.

Gunakan surface yang sesuai dengan actionability.

---

## 14. Frontend Error Normalization Layer

Frontend jangan membiarkan semua komponen memahami error mentah dari `fetch`, Axios, framework, gateway, dan API.

Buat satu normalization layer.

### 14.1 Raw Error Sources

Frontend bisa menerima:

- `TypeError` dari `fetch`;
- `DOMException` karena abort;
- HTTP response dengan problem+json;
- HTTP response dengan HTML error page dari gateway;
- empty response body;
- malformed JSON;
- opaque response;
- CDN-generated error;
- API legacy error format;
- validation error format lama;
- timeout wrapper error.

Komponen UI tidak boleh memproses semua variasi ini satu per satu.

### 14.2 Normalized Error Type

Contoh TypeScript:

```ts
export type NormalizedHttpError = {
  kind: "http";
  status: number;
  code: string;
  title?: string;
  detail?: string;
  userMessage?: string;
  errors?: FieldError[];
  correlationId?: string;
  traceId?: string;
  supportReference?: string;
  retryAfterSeconds?: number;
  raw?: unknown;
};

export type NormalizedNetworkError = {
  kind: "network";
  code:
    | "NETWORK_ERROR"
    | "TIMEOUT"
    | "ABORTED"
    | "OFFLINE"
    | "CORS_OR_BROWSER_BLOCKED";
  userMessage?: string;
  raw?: unknown;
};

export type NormalizedError = NormalizedHttpError | NormalizedNetworkError;
```

### 14.3 Parser yang Defensive

```ts
async function parseErrorResponse(response: Response): Promise<NormalizedHttpError> {
  const contentType = response.headers.get("content-type") ?? "";
  const retryAfter = response.headers.get("retry-after");

  let body: any = null;

  if (contentType.includes("application/problem+json") || contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    // Gateway bisa mengirim HTML error page.
    // Jangan tampilkan mentah ke user.
    body = null;
  }

  return {
    kind: "http",
    status: response.status,
    code: body?.code ?? defaultCodeForStatus(response.status),
    title: body?.title,
    detail: body?.detail,
    userMessage: body?.userMessage,
    errors: Array.isArray(body?.errors) ? body.errors : undefined,
    correlationId: body?.correlationId ?? response.headers.get("x-correlation-id") ?? undefined,
    traceId: body?.traceId ?? undefined,
    supportReference: body?.supportReference,
    retryAfterSeconds: parseRetryAfterSeconds(retryAfter) ?? body?.retryAfterSeconds,
    raw: body
  };
}
```

### 14.4 `fetch` Wrapper Example

```ts
export async function httpJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (err) {
    throw normalizeNetworkError(err);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    throw {
      kind: "network",
      code: "INVALID_RESPONSE_BODY",
      userMessage: "The server returned an invalid response.",
      raw: err
    };
  }
}
```

Catatan: `INVALID_RESPONSE_BODY` bukan network error murni, tapi sering ditempatkan di normalized non-HTTP-error bucket karena HTTP status sukses tetapi body tidak bisa diproses.

---

## 15. Backend Java/Spring Mapping Example

Sebagai Java engineer, Anda perlu memastikan backend menghasilkan contract konsisten.

### 15.1 Problem DTO

```java
public record ApiProblem(
    String type,
    String title,
    int status,
    String detail,
    String instance,
    String code,
    String userMessage,
    String correlationId,
    String traceId,
    List<FieldProblem> errors
) {}

public record FieldProblem(
    String field,
    String code,
    String message
) {}
```

### 15.2 Exception Hierarchy

```java
public abstract class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final String userMessage;

    protected ApiException(HttpStatus status, String code, String userMessage, String message) {
        super(message);
        this.status = status;
        this.code = code;
        this.userMessage = userMessage;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
    public String userMessage() { return userMessage; }
}
```

Example domain exception:

```java
public final class CaseAlreadyClosedException extends ApiException {
    public CaseAlreadyClosedException(String caseId) {
        super(
            HttpStatus.CONFLICT,
            "CASE_ALREADY_CLOSED",
            "This case has already been closed.",
            "Case %s is already closed".formatted(caseId)
        );
    }
}
```

### 15.3 Controller Advice

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiProblem> handleApiException(
        ApiException ex,
        HttpServletRequest request
    ) {
        ApiProblem problem = new ApiProblem(
            "https://api.example.com/problems/" + ex.code().toLowerCase().replace('_', '-'),
            titleFromCode(ex.code()),
            ex.status().value(),
            ex.getMessage(),
            request.getRequestURI(),
            ex.code(),
            ex.userMessage(),
            currentCorrelationId(),
            currentTraceId(),
            List.of()
        );

        return ResponseEntity
            .status(ex.status())
            .contentType(MediaType.valueOf("application/problem+json"))
            .body(problem);
    }
}
```

### 15.4 Validation Exception Mapping

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
ResponseEntity<ApiProblem> handleValidation(
    MethodArgumentNotValidException ex,
    HttpServletRequest request
) {
    List<FieldProblem> fields = ex.getBindingResult()
        .getFieldErrors()
        .stream()
        .map(error -> new FieldProblem(
            error.getField(),
            validationCode(error),
            safeValidationMessage(error)
        ))
        .toList();

    ApiProblem problem = new ApiProblem(
        "https://api.example.com/problems/validation-error",
        "Validation failed",
        422,
        "One or more fields are invalid.",
        request.getRequestURI(),
        "VALIDATION_FAILED",
        "Please fix the highlighted fields.",
        currentCorrelationId(),
        currentTraceId(),
        fields
    );

    return ResponseEntity
        .status(422)
        .contentType(MediaType.valueOf("application/problem+json"))
        .body(problem);
}
```

Catatan:

- Jangan expose raw exception untuk unexpected error.
- Gunakan global fallback handler untuk `Exception`.
- Pastikan semua error response punya content type konsisten.
- Pastikan gateway error juga distandardisasi jika memungkinkan.

---

## 16. Error Contract untuk Long-Running Operation

Long-running operation sering dimulai dengan:

```http
POST /exports
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /operations/op-123
```

Jika operation gagal saat diproses async, error tidak lagi muncul di response awal. Ia muncul di operation status resource.

Contoh:

```http
GET /operations/op-123
```

```json
{
  "id": "op-123",
  "status": "FAILED",
  "error": {
    "type": "https://api.example.com/problems/export-too-large",
    "title": "Export too large",
    "status": 422,
    "code": "EXPORT_TOO_LARGE",
    "userMessage": "The selected export is too large. Narrow the date range and try again."
  }
}
```

Frontend handling:

- operation state machine harus punya `FAILED` state;
- error contract tetap sama;
- jangan pakai HTTP `200` status operation sebagai arti operation sukses;
- bedakan `GET /operations/op-123` sukses dibaca dari operation yang gagal.

Mental model:

```text
HTTP request to status resource succeeded
but business operation represented by that resource failed
```

---

## 17. Partial Failure and Bulk Operations

Bulk operation jarang binary sukses/gagal.

Contoh:

```http
POST /cases/bulk-assign
```

Response:

```http
HTTP/1.1 207 Multi-Status
Content-Type: application/json
```

Atau lebih umum:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

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
      "status": "SUCCESS"
    },
    {
      "caseId": "CASE-2",
      "status": "FAILED",
      "error": {
        "code": "CASE_ALREADY_CLOSED",
        "userMessage": "This case is already closed."
      }
    },
    {
      "caseId": "CASE-3",
      "status": "SUCCESS"
    }
  ]
}
```

Decision point:

- Jika seluruh bulk request tidak bisa diproses karena request invalid: gunakan 400/422.
- Jika request diproses dan hasil item-level campuran: response body harus mengekspresikan partial outcome.
- Jangan sembunyikan partial failure sebagai sukses penuh.

Frontend harus:

- tampilkan summary;
- highlight failed items;
- sediakan retry selected failed;
- hindari rollback semua jika sebagian sukses secara permanen;
- emit telemetry untuk failure ratio.

---

## 18. Graph: Dari Error ke Action

Gunakan alur ini saat mendesain frontend handler.

```text
Did JavaScript receive a readable HTTP response?
├─ No
│  ├─ Was it aborted intentionally? → ignore or mark cancelled
│  ├─ Is browser offline? → offline banner / queue
│  ├─ Timeout? → retry/manual retry depending operation
│  └─ CORS/TLS/browser blocked? → generic network error + telemetry
│
└─ Yes
   ├─ status 2xx? → parse success body / operation state
   ├─ status 3xx? → usually handled by browser; fetch edge cases
   ├─ status 400? → bad request; likely client bug or malformed input
   ├─ status 401? → auth recovery/login
   ├─ status 403? → forbidden UX
   ├─ status 404? → not found UX
   ├─ status 409/412? → conflict resolution / refresh
   ├─ status 422? → validation UI
   ├─ status 429? → rate limit handling / Retry-After
   ├─ status 5xx? → server/gateway failure / retry if safe
   └─ unknown? → generic fallback + telemetry
```

---

## 19. Testing Error Contracts

Error contract harus dites seperti success contract.

### 19.1 Backend Contract Tests

Test:

- content type `application/problem+json`;
- status code benar;
- `status` field cocok dengan HTTP status;
- `code` stabil;
- validation `errors[]` punya field path yang benar;
- no stack trace leakage;
- `correlationId` ada;
- `Retry-After` ada untuk `429/503` jika relevan;
- unexpected exception dimapping ke generic 500.

Contoh assertion:

```java
mockMvc.perform(post("/cases").content("{}"))
    .andExpect(status().isUnprocessableEntity())
    .andExpect(header().string("Content-Type", containsString("application/problem+json")))
    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
    .andExpect(jsonPath("$.errors").isArray());
```

### 19.2 Frontend Tests

Test:

- `401` triggers auth flow;
- `403` renders forbidden page;
- `404` renders not-found;
- `422` maps field errors;
- `409` opens conflict dialog;
- `429` respects retry-after;
- HTML gateway error page becomes generic error;
- malformed JSON error does not crash app;
- aborted request does not show scary toast;
- network error shows correct recovery UI.

Example pseudo-test:

```ts
it("maps validation problem to inline field errors", async () => {
  server.use(
    http.post("/cases", () => {
      return HttpResponse.json(
        {
          type: "https://api.example.com/problems/validation-error",
          title: "Validation failed",
          status: 422,
          code: "VALIDATION_FAILED",
          errors: [
            { field: "title", code: "REQUIRED", message: "Title is required." }
          ]
        },
        { status: 422, headers: { "Content-Type": "application/problem+json" } }
      );
    })
  );

  await submitCaseForm();

  expect(screen.getByText("Title is required.")).toBeVisible();
});
```

---

## 20. Error Documentation Template

Setiap API/domain error penting harus terdokumentasi.

Template:

```md
## CASE_ALREADY_CLOSED

HTTP status: 409 Conflict
Problem type: https://api.example.com/problems/case-already-closed
Code: CASE_ALREADY_CLOSED
Retryable: No
User action: Refresh case and review latest state
Frontend surface: Conflict dialog or page banner
Telemetry level: Warning
Security note: Do not reveal actor who closed the case unless user has permission
Example:

{
  "type": "https://api.example.com/problems/case-already-closed",
  "title": "Case already closed",
  "status": 409,
  "code": "CASE_ALREADY_CLOSED",
  "userMessage": "This case has already been closed. Refresh to see the latest version.",
  "correlationId": "req-..."
}
```

Minimal metadata:

| Metadata | Required |
|---|---:|
| HTTP status | yes |
| domain code | yes |
| problem type | yes |
| retryability | yes |
| frontend UI behavior | yes |
| user action | yes |
| security caveat | for sensitive errors |
| example response | yes |

---

## 21. Anti-Patterns

### 21.1 Always 200

```http
HTTP/1.1 200 OK

{
  "success": false
}
```

Efek buruk:

- monitoring bohong;
- gateway tidak bisa bereaksi;
- client harus parse body;
- retry policy kacau.

### 21.2 Always 500

```http
HTTP/1.1 500 Internal Server Error

{
  "message": "Email invalid"
}
```

Efek buruk:

- validasi user dianggap server outage;
- alerting noisy;
- frontend tampilkan generic failure padahal bisa inline error.

### 21.3 Message-Based Branching

```ts
if (error.message === "Token expired") refresh();
```

Gunakan `status` dan `code`.

### 21.4 Leaking Stack Trace

Jangan pernah expose stack trace di production response.

### 21.5 Inconsistent Shape

Endpoint A:

```json
{ "error": "Invalid" }
```

Endpoint B:

```json
{ "message": "Invalid" }
```

Endpoint C:

```json
{ "errors": { "email": "Invalid" } }
```

Akibat:

- frontend parsing berantakan;
- test sulit;
- UX tidak konsisten;
- error analytics tidak reliable.

### 21.6 Hiding Gateway Errors

Gateway mengirim HTML error page. Frontend mencoba parse JSON dan crash.

Client harus defensive terhadap non-JSON error.

### 21.7 No Correlation ID

User melapor “error terjadi”, support tidak bisa menelusuri.

### 21.8 Over-specific Error Leakage

```json
{
  "code": "USER_EXISTS_BUT_PASSWORD_HASH_BCRYPT_MISMATCH"
}
```

Ini terlalu banyak informasi.

---

## 22. Practical Review Checklist

Gunakan checklist ini saat review API/frontend error handling.

### 22.1 HTTP Semantics

- [ ] Status code sesuai outcome.
- [ ] Tidak menggunakan `200` untuk failure.
- [ ] `401` dan `403` dibedakan.
- [ ] `409` dan `412` dipakai untuk conflict/concurrency dengan tepat.
- [ ] `422` dipakai untuk domain validation jika tim menyepakatinya.
- [ ] `429/503` memakai `Retry-After` jika relevan.

### 22.2 Body Shape

- [ ] Error body konsisten.
- [ ] Menggunakan `application/problem+json` atau shape problem-compatible.
- [ ] Ada `code` stabil.
- [ ] Ada `userMessage` atau frontend punya localization mapping.
- [ ] Ada `errors[]` untuk validation.
- [ ] `status` body cocok dengan HTTP status.

### 22.3 Security

- [ ] Tidak ada stack trace.
- [ ] Tidak ada SQL/internal exception detail.
- [ ] Tidak ada secret/token/password.
- [ ] Tidak membocorkan resource existence jika sensitif.
- [ ] Rejected value tidak membocorkan PII.

### 22.4 Frontend Behavior

- [ ] Error dinormalisasi di satu layer.
- [ ] UI mapping eksplisit.
- [ ] Validation masuk inline field error.
- [ ] Auth error memicu auth flow.
- [ ] Conflict punya recovery path.
- [ ] Network/browser error punya fallback.
- [ ] Abort tidak diperlakukan sebagai fatal error.

### 22.5 Observability

- [ ] Ada correlation ID.
- [ ] Ada trace/support reference jika perlu.
- [ ] Frontend telemetry menangkap status/code/correlation.
- [ ] Error analytics tidak bergantung pada message string.
- [ ] Unexpected error dimonitor tanpa membocorkan detail ke user.

### 22.6 Evolution

- [ ] Code terdokumentasi.
- [ ] Breaking change dihindari.
- [ ] Field baru additive.
- [ ] Client lama tetap aman jika field baru muncul.
- [ ] Contract tests mencakup error response.

---

## 23. Capstone Exercise

Desain error contract untuk workflow berikut:

```text
User membuka case detail.
User mengubah assignee.
Sementara itu, user lain menutup case.
User pertama menekan Save.
```

Backend menerima:

```http
PATCH /cases/CASE-123
If-Match: "v12"
Content-Type: application/json

{
  "assigneeId": "USR-9"
}
```

Resource saat ini sudah:

```json
{
  "caseId": "CASE-123",
  "status": "CLOSED",
  "version": "v13"
}
```

Pertanyaan:

1. Status code apa?
2. Error code apa?
3. Apakah ini `409` atau `412`?
4. Apa `userMessage`?
5. Apa recovery action UI?
6. Apakah perlu latest resource snapshot?
7. Apakah frontend harus preserve unsaved input?
8. Apakah retry otomatis boleh?
9. Apa telemetry yang dikirim?

Jawaban yang defensible:

- Jika fokus pada validator mismatch `If-Match`, `412 Precondition Failed` sangat tepat.
- Jika request tidak memakai precondition dan konflik dengan state `CLOSED`, `409 Conflict` tepat.
- Dalam kasus ini ada `If-Match: "v12"` dan current `v13`, jadi `412` lebih presisi.

Contoh:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
ETag: "v13"

{
  "type": "https://api.example.com/problems/version-mismatch",
  "title": "Version mismatch",
  "status": 412,
  "code": "VERSION_MISMATCH",
  "userMessage": "This case has changed since you opened it. Refresh and review the latest version before saving.",
  "expectedVersion": "v12",
  "actualVersion": "v13",
  "currentState": "CLOSED",
  "correlationId": "req-20260618-9f7a"
}
```

Frontend behavior:

```text
- stop saving spinner
- keep user's unsaved assignee selection locally
- show conflict/reload banner or dialog
- fetch latest case representation
- explain that the case is now closed
- disable assignee editing if CLOSED disallows it
- do not retry automatically
- emit telemetry: status=412, code=VERSION_MISMATCH, caseId hash/reference, correlationId
```

---

## 24. Ringkasan Mental Model

Error contract yang bagus punya struktur:

```text
HTTP status = class of outcome
problem type = stable category URI
code = machine-readable domain/API decision key
title/detail = human/developer explanation
userMessage = safe end-user text
errors[] = field/domain validation details
Retry-After = protocol retry timing
correlation/trace/support ID = observability bridge
```

Frontend yang matang tidak bertanya:

```text
Apa message error-nya?
```

Tapi bertanya:

```text
Apa status code-nya?
Apa domain code-nya?
Apakah user bisa memperbaiki?
Apakah retry aman?
Apa UI surface yang tepat?
Bagaimana support menelusuri?
Apakah response aman secara security?
```

---

## 25. Koneksi ke Part Berikutnya

Part ini menyelesaikan dasar error contract. Selanjutnya kita masuk ke model komunikasi yang tidak selalu request-response biasa:

```text
Part 026 — Streaming, SSE, WebSocket, WebTransport, and Long Polling
```

Di sana error contract menjadi lebih kompleks karena failure bisa terjadi:

- sebelum koneksi terbentuk;
- saat stream berjalan;
- setelah sebagian data diterima;
- saat reconnect;
- di message-level, bukan HTTP response-level;
- melalui proxy/CDN timeout;
- karena tab/browser lifecycle.

Prinsip dari Part 025 tetap berlaku: error harus bisa dibaca sebagai state transition yang jelas, bukan hanya “something failed”.

---

## Referensi Utama

- RFC 9457 — Problem Details for HTTP APIs.
- RFC 9110 — HTTP Semantics.
- MDN — HTTP response status codes.
- MDN — `Retry-After` header.
- OWASP REST Security Cheat Sheet.
- OWASP Error Handling Cheat Sheet.
- W3C Trace Context.
- Spring Framework documentation: error handling and `ProblemDetail` concepts.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-024.md">⬅️ Part 024 — Mutation Design: Idempotency, Optimistic UI, Concurrency, and Conflict</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-026.md">Part 026 — Streaming, SSE, WebSocket, WebTransport, and Long Polling ➡️</a>
</div>
