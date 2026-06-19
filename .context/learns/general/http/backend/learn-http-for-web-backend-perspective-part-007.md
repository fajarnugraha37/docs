# learn-http-for-web-backend-perspective-part-007.md

# Part 007 — URI, Routing, and Resource Modeling

> Series: `learn-http-for-web-backend-perspective`  
> Audience: Java software engineer / backend engineer  
> Focus: HTTP backend perspective  
> Status: Part 007 of 032  
> Previous: Part 006 — Request Body, Response Body, and Message Framing  
> Next: Part 008 — Content Negotiation and Representation Design

---

## 0. Why This Part Matters

Banyak backend engineer mengira URI design adalah urusan naming convention:

```http
GET /users/123
POST /orders
DELETE /files/abc
```

Itu terlalu dangkal.

Dari perspektif backend production, URI adalah bagian dari **public system model**. URI menentukan:

- apa yang dianggap sebagai resource;
- apa yang dianggap sebagai identity;
- boundary antar aggregate/domain object;
- apakah operation terlihat sebagai state transition, query, command, atau relationship;
- bagaimana cache, authorization, routing, audit, observability, gateway policy, dan client SDK bekerja;
- apakah API bisa berevolusi tanpa mematahkan client;
- apakah backend mudah di-debug saat traffic sudah melewati CDN, gateway, proxy, service mesh, dan application router.

URI yang buruk bukan hanya “kurang RESTful”. URI yang buruk bisa menyebabkan:

- route ambiguity;
- authorization bypass;
- cache poisoning;
- broken object-level authorization;
- duplicate domain model;
- client coupling berlebihan;
- workflow yang sulit diaudit;
- endpoint explosion;
- perubahan kecil menjadi breaking change;
- incident debugging menjadi kabur karena metrics terlalu high-cardinality atau path tidak konsisten.

Target part ini: setelah selesai, kamu tidak hanya bisa membuat endpoint yang “rapi”, tapi bisa merancang URI sebagai kontrak backend yang stabil, defensible, dan operable.

---

## 1. Mental Model: URI Is Identifier, Route Is Implementation

Hal pertama yang harus dipisahkan:

```text
URI       = identifier yang terlihat oleh client
Route     = rule internal server untuk mencocokkan URI ke handler
Resource  = konsep/domain object/state view yang diidentifikasi oleh URI
Handler   = kode yang mengeksekusi request terhadap resource
```

Contoh:

```http
GET /cases/C-2026-000123/evidence/E-9981
```

URI di atas mengidentifikasi sebuah evidence dalam konteks case.

Di backend Java/Spring, route-nya mungkin:

```java
@GetMapping("/cases/{caseId}/evidence/{evidenceId}")
EvidenceResponse getEvidence(
    @PathVariable String caseId,
    @PathVariable String evidenceId
) { ... }
```

Tapi jangan campuradukkan:

- URI bukan controller method name.
- URI bukan table name.
- URI bukan package structure.
- URI bukan command bus topic.
- URI bukan microservice boundary.
- URI bukan database join path.

URI adalah **external contract**. Route adalah **implementation mapping**.

### 1.1 URI yang Baik Tidak Harus Membocorkan Struktur Internal

Buruk:

```http
GET /case-service/v1/case_table/123/evidence_table/9981
```

Masalah:

- membocorkan nama service;
- membocorkan nama tabel;
- mengikat client ke implementation detail;
- susah diganti saat service split/merge;
- nama teknis tidak selalu sesuai dengan bahasa domain.

Lebih baik:

```http
GET /cases/C-2026-000123/evidence/E-9981
```

Ini berbicara dalam bahasa domain.

### 1.2 Route yang Baik Boleh Lebih Kompleks dari URI

URI external boleh stabil dan sederhana, sementara route internal bisa melewati banyak layer:

```text
Request URI
  -> gateway route
  -> service route
  -> security filter
  -> tenant resolver
  -> controller
  -> application service
  -> domain policy
  -> repository/query model
```

Client tidak perlu tahu semua itu.

Top 1% backend engineer menjaga perbedaan ini. Mereka tidak menjadikan URI sebagai cermin arsitektur internal yang berubah-ubah.

---

## 2. Standards Baseline: Anatomy of a URI

Secara generic syntax, URI terdiri dari komponen:

```text
scheme://authority/path?query#fragment
```

Contoh:

```text
https://api.example.gov/cases/C-2026-000123/evidence?type=document&page=2#section-a
```

Komponennya:

```text
scheme    = https
authority = api.example.gov
path      = /cases/C-2026-000123/evidence
query     = type=document&page=2
fragment  = section-a
```

Dalam HTTP backend API, yang paling sering kita desain adalah:

- host/authority;
- path;
- query.

Fragment biasanya tidak dikirim ke server oleh user agent dalam request HTTP umum. Jadi jangan mendesain backend behavior yang bergantung pada fragment.

### 2.1 Scheme

```text
https
```

Scheme menunjukkan protokol URI. Untuk production API modern, `https` harus menjadi default. `http` biasanya hanya untuk local development, internal trusted lab, atau termination tertentu sebelum edge—tetap harus hati-hati.

Backend implication:

- absolute URL generation harus tahu original scheme;
- reverse proxy TLS termination harus meneruskan scheme dengan aman;
- jangan mempercayai `X-Forwarded-Proto` dari public internet tanpa trusted proxy boundary;
- cookie `Secure`, HSTS, redirect, dan OAuth callback bergantung pada scheme benar.

### 2.2 Authority / Host

```text
api.example.gov
```

Authority sering dipakai untuk:

- environment separation;
- tenant separation;
- regional routing;
- product/API grouping;
- public vs internal API boundary.

Contoh:

```text
api.example.gov
internal-api.example.gov
tenant-a.api.example.gov
id.example.gov
files.example.gov
```

Backend implication:

- Host header harus divalidasi;
- absolute link generation harus aman;
- multi-tenant host-based routing perlu allowlist;
- wildcard domain bisa meningkatkan risiko host header injection atau tenant confusion.

### 2.3 Path

```text
/cases/C-2026-000123/evidence/E-9981
```

Path biasanya dipakai untuk resource identity dan hierarchy.

Backend implication:

- path cocok untuk identifier yang merupakan bagian dari resource identity;
- path cocok untuk stable resource location;
- path kurang cocok untuk filter kombinatorial;
- terlalu banyak nested path bisa membuat authorization dan lifecycle membingungkan;
- path matching harus memperhatikan encoding, slash, semicolon, dot, trailing slash, dan case sensitivity.

### 2.4 Query

```text
?status=open&assignedTo=u123&page=2&sort=-createdAt
```

Query biasanya dipakai untuk:

- filtering;
- searching;
- pagination;
- sorting;
- projection;
- optional modifiers;
- non-identity retrieval parameters.

Backend implication:

- query parameter ikut menentukan effective request target;
- shared cache bisa memperlakukan URI dengan query sebagai berbeda;
- query harus divalidasi seperti body;
- query string sering muncul di logs, metrics, referer, browser history, dan proxy logs, jadi jangan letakkan secret di query.

### 2.5 Fragment

```text
#section-a
```

Fragment adalah client-side identifier. Dalam API backend, biasanya jangan dipakai untuk server behavior.

Buruk:

```text
GET /cases/C-1#evidence
```

Server umumnya tidak menerima fragment tersebut sebagai bagian request target. Gunakan path atau query.

---

## 3. Resource Modeling: The Core Skill

Resource bukan selalu database row.

Resource adalah sesuatu yang bisa diidentifikasi dan direpresentasikan melalui HTTP.

Resource bisa berupa:

- entity;
- collection;
- relationship;
- document;
- workflow state;
- task;
- search result;
- export job;
- report;
- decision;
- assignment;
- audit trail;
- policy evaluation result;
- command result;
- async operation status.

### 3.1 Entity Resource

```http
GET /cases/C-2026-000123
```

Resource: satu case.

Potential representation:

```json
{
  "id": "C-2026-000123",
  "status": "UNDER_REVIEW",
  "subject": "Potential violation of reporting obligation",
  "assignedUnit": "ENFORCEMENT_A",
  "createdAt": "2026-06-18T09:00:00Z"
}
```

### 3.2 Collection Resource

```http
GET /cases
POST /cases
```

Resource: collection of cases.

`GET /cases` mengambil daftar/filter.

`POST /cases` membuat subordinate resource baru dalam collection.

### 3.3 Sub-Resource

```http
GET /cases/C-2026-000123/evidence/E-9981
```

Resource: evidence yang berada dalam konteks case tertentu.

Sub-resource cocok jika:

- lifecycle-nya bergantung pada parent;
- authorization perlu parent context;
- identity globalnya tidak cukup bermakna tanpa parent;
- client secara domain memang menavigasi dari parent ke child.

### 3.4 Relationship Resource

Kadang relationship sendiri perlu jadi resource.

Contoh assignment investigator ke case:

```http
GET /cases/C-2026-000123/assignments
POST /cases/C-2026-000123/assignments
DELETE /cases/C-2026-000123/assignments/U-8821
```

Di sini assignment bukan hanya field `assignedTo`. Assignment bisa punya:

- siapa assigned;
- role;
- assignedAt;
- assignedBy;
- reason;
- expiration;
- conflict-of-interest declaration;
- audit trail.

Kalau relationship punya lifecycle dan metadata, jadikan resource.

### 3.5 Computed/View Resource

```http
GET /cases/C-2026-000123/risk-assessment
```

Risk assessment bisa bukan table row. Bisa hasil komputasi.

Tetap valid sebagai resource jika:

- punya identity;
- bisa direpresentasikan;
- punya caching/validation semantics;
- punya authorization boundary.

### 3.6 Operation/Task Resource

Untuk operasi asynchronous:

```http
POST /exports
GET /exports/EX-2026-00077
GET /exports/EX-2026-00077/file
```

Resource bukan “function call”. Resource-nya adalah export job dan file hasilnya.

Ini jauh lebih operable daripada:

```http
POST /generateBigReportAndWait
```

Karena async operation resource memungkinkan:

- polling;
- retry;
- cancellation;
- audit;
- ownership;
- status tracking;
- expiration;
- error details;
- observability.

---

## 4. Path vs Query: The Backend Decision Rule

Pertanyaan paling umum:

> Parameter ini harus di path atau query?

Gunakan mental model berikut.

### 4.1 Path untuk Identity dan Hierarchy

Gunakan path jika parameter adalah bagian dari **identity** resource.

```http
GET /cases/C-2026-000123
GET /cases/C-2026-000123/evidence/E-9981
GET /tenants/T-001/users/U-123
```

Jika parameter diubah, kamu sedang menunjuk resource lain.

### 4.2 Query untuk Selection, Filtering, Sorting, Projection

Gunakan query jika parameter memodifikasi cara memilih/menampilkan collection atau representation.

```http
GET /cases?status=open&assignedTo=U-123
GET /cases?createdAfter=2026-01-01&sort=-createdAt
GET /cases/C-2026-000123/events?type=STATUS_CHANGED&page=2
```

Jika parameter diubah, kamu biasanya masih berinteraksi dengan collection/resource base yang sama, tetapi selected subset/representation berubah.

### 4.3 Decision Matrix

| Question | Prefer |
|---|---|
| Apakah nilai ini bagian dari identity resource? | Path |
| Apakah nilai ini optional filter? | Query |
| Apakah nilai ini sorting/pagination/projection? | Query |
| Apakah nilai ini parent context yang menentukan authorization? | Path, jika domain hierarchy jelas |
| Apakah nilai ini secret/token? | Neither, jangan query; gunakan header/body sesuai konteks |
| Apakah nilai ini command payload kompleks? | Body |
| Apakah nilai ini version API? | Bisa path/header/media type; pilih governance strategy |
| Apakah nilai ini hanya display preference? | Query/header tergantung semantics |

### 4.4 Example: Case Search

Buruk:

```http
GET /cases/status/open/assigned-to/U-123/from/2026-01-01/to/2026-02-01
```

Masalah:

- path menjadi pseudo-query language;
- route explosion;
- optional filter sulit;
- order parameter jadi signifikan;
- sulit extend;
- sulit cache governance;
- sulit dokumentasi.

Lebih baik:

```http
GET /cases?status=open&assignedTo=U-123&createdFrom=2026-01-01&createdTo=2026-02-01
```

### 4.5 Example: Tenant Context

Ada dua pendekatan:

```http
GET /tenants/T-001/cases/C-123
```

atau:

```http
GET /cases/C-123
X-Tenant-ID: T-001
```

atau host-based:

```http
GET https://t-001.api.example.gov/cases/C-123
```

Tidak ada satu jawaban universal.

Pertimbangkan:

- apakah case ID global atau tenant-local;
- apakah tenant boundary harus visible di URI;
- apakah gateway melakukan tenant routing;
- apakah logs/metrics perlu tenant isolation;
- apakah client SDK lebih sederhana dengan tenant context global;
- apakah resource bisa berpindah tenant;
- apakah ada risiko tenant spoofing di header.

Untuk sistem regulatori/multi-tenant yang sensitif, explicit tenant context sering lebih defensible, tetapi harus konsisten dan divalidasi terhadap authenticated principal.

---

## 5. Collection, Item, and Sub-Collection Patterns

### 5.1 Basic Collection Pattern

```http
GET  /cases
POST /cases
GET  /cases/{caseId}
PUT  /cases/{caseId}
PATCH /cases/{caseId}
DELETE /cases/{caseId}
```

Ini pattern dasar.

Tapi jangan otomatis membuat semua method untuk semua resource. Method yang disediakan harus sesuai lifecycle domain.

Untuk case enforcement:

```http
GET /cases/{caseId}
PATCH /cases/{caseId}
DELETE /cases/{caseId}
```

Mungkin `DELETE` tidak valid karena case tidak boleh dihapus, hanya bisa closed, withdrawn, archived, or voided.

Lebih domain-accurate:

```http
POST /cases/{caseId}/closure-requests
POST /cases/{caseId}/voidance-requests
```

Atau:

```http
PATCH /cases/{caseId}
Content-Type: application/merge-patch+json

{
  "status": "CLOSED",
  "closureReason": "DUPLICATE"
}
```

Mana yang benar bergantung pada apakah closure adalah simple state update atau workflow object dengan review/audit.

### 5.2 Sub-Collection Pattern

```http
GET  /cases/{caseId}/evidence
POST /cases/{caseId}/evidence
GET  /cases/{caseId}/evidence/{evidenceId}
DELETE /cases/{caseId}/evidence/{evidenceId}
```

Cocok jika evidence lifecycle scoped ke case.

### 5.3 Avoid Arbitrary Deep Nesting

Terlalu dalam:

```http
GET /agencies/A-1/departments/D-2/units/U-3/cases/C-4/evidence/E-5/attachments/F-6/versions/V-7
```

Masalah:

- path panjang dan rapuh;
- route matching rumit;
- banyak ID perlu divalidasi;
- parent-child consistency checks banyak;
- authorization menjadi mahal;
- resource mungkin sebenarnya punya global identity.

Lebih baik:

```http
GET /file-versions/V-7
```

atau:

```http
GET /cases/C-4/evidence/E-5/attachments/F-6/versions/V-7
```

Jika agency/department/unit hanya filter atau authorization context, jangan semuanya dipaksa ke path.

### 5.4 Rule of Thumb for Nesting

Gunakan nesting jika:

- child tidak bermakna tanpa parent;
- parent menentukan authorization;
- parent-child relationship stable;
- depth masih manusiawi;
- URI mencerminkan domain navigation yang nyata.

Hindari nesting jika:

- kamu hanya meniru join database;
- parent bisa berubah;
- child punya global identity;
- banyak parent alternatif;
- path menjadi query language;
- semua analytics/reporting dibuat sebagai path hierarchy.

---

## 6. Action Resource: Kapan Valid, Kapan Bau Desain

Banyak guideline bilang URI harus noun, bukan verb. Itu useful, tapi sering terlalu simplistik.

Buruk:

```http
POST /approveCase
POST /rejectCase
POST /assignInvestigator
POST /downloadEvidence
```

Lebih baik dalam banyak kasus:

```http
POST /cases/{caseId}/approval-decisions
POST /cases/{caseId}/rejection-decisions
POST /cases/{caseId}/assignments
GET  /cases/{caseId}/evidence/{evidenceId}/file
```

Namun workflow-heavy backend sering punya domain actions yang tidak nyaman jika dipaksa menjadi CRUD field update.

Kuncinya: ubah action menjadi **resource yang merepresentasikan hasil/lifecycle action**.

### 6.1 Approval as Resource

Daripada:

```http
POST /cases/C-123/approve
```

Pertimbangkan:

```http
POST /cases/C-123/approval-decisions
```

Body:

```json
{
  "decision": "APPROVED",
  "reasonCode": "SUFFICIENT_EVIDENCE",
  "notes": "All required checks completed."
}
```

Response:

```http
201 Created
Location: /cases/C-123/approval-decisions/D-789
```

Kenapa lebih baik?

Approval decision punya identity, audit trail, actor, timestamp, reason, possible revocation, legal defensibility.

### 6.2 Transition Request as Resource

Untuk state transition yang butuh review:

```http
POST /cases/C-123/escalation-requests
```

Response:

```http
202 Accepted
Location: /cases/C-123/escalation-requests/ER-456
```

Ini lebih jujur daripada:

```http
POST /cases/C-123/escalate
```

karena escalation mungkin asynchronous, policy-driven, dan bisa gagal setelah validasi lanjutan.

### 6.3 Command Endpoint Masih Bisa Valid

Kadang RPC-like command over HTTP sah-sah saja, terutama untuk internal APIs atau command-heavy systems.

Contoh:

```http
POST /case-commands/escalate-case
```

Ini tidak otomatis salah. Tapi kamu harus sadar trade-off:

- cacheability rendah;
- resource navigation lemah;
- status tracking harus didesain manual;
- observability bisa command-centric;
- API lebih mirip RPC;
- evolusi lebih bergantung pada command schema.

Jika memilih command endpoint, lakukan dengan sengaja, bukan karena tidak memahami resource modeling.

### 6.4 Action Naming Smell Checklist

Endpoint berbau desain buruk jika:

```http
POST /getSomething
GET /deleteSomething
POST /updateSomething
POST /doEverything
POST /process
POST /submitAndApproveAndNotify
```

Pertanyaan korektif:

- Resource apa yang berubah?
- Apakah operation menghasilkan resource baru?
- Apakah operation adalah transition request?
- Apakah operation punya audit record?
- Apakah operation asynchronous?
- Apakah client perlu melihat status/result operation nanti?
- Apakah operation idempotent?

---

## 7. URI and Domain State Machines

Untuk workflow-heavy backend, URI design harus selaras dengan state machine.

Misal case lifecycle:

```text
DRAFT
  -> SUBMITTED
  -> TRIAGED
  -> UNDER_INVESTIGATION
  -> UNDER_LEGAL_REVIEW
  -> DECISION_PENDING
  -> DECIDED
  -> CLOSED
```

Naive endpoint:

```http
POST /cases/{caseId}/changeStatus
```

Masalah:

- terlalu generic;
- authorization sulit per transition;
- validation per transition bercampur;
- audit reason tidak eksplisit;
- observability tidak tahu transition mana yang sering gagal;
- client bisa mencoba transition illegal.

Lebih explicit:

```http
POST /cases/{caseId}/submissions
POST /cases/{caseId}/triage-decisions
POST /cases/{caseId}/investigation-assignments
POST /cases/{caseId}/legal-review-requests
POST /cases/{caseId}/decisions
POST /cases/{caseId}/closure-records
```

Setiap transition penting menjadi resource atau collection.

### 7.1 Transition Resource Pattern

```http
POST /cases/{caseId}/transitions
```

Body:

```json
{
  "targetStatus": "UNDER_LEGAL_REVIEW",
  "reasonCode": "COMPLEX_INTERPRETATION_REQUIRED",
  "comment": "Potential statutory ambiguity."
}
```

Ini fleksibel, tetapi kurang explicit.

### 7.2 Specific Transition Resource Pattern

```http
POST /cases/{caseId}/legal-review-requests
```

Lebih explicit dan lebih mudah diamankan.

Trade-off:

| Approach | Strength | Weakness |
|---|---|---|
| Generic `/transitions` | Flexible, fewer endpoints | authorization/validation can become complex |
| Specific transition resources | Clear, auditable, secure | more endpoints, more design work |

Untuk domain regulatori/penegakan hukum, specific transition resource sering lebih defensible karena setiap action penting punya vocabulary, policy, dan audit trail sendiri.

---

## 8. Query Parameter Design

Query parameter sering terlihat kecil, tapi bisa menjadi sumber kompleksitas besar.

### 8.1 Filtering

Basic:

```http
GET /cases?status=open&priority=high
```

Range:

```http
GET /cases?createdFrom=2026-01-01&createdTo=2026-06-01
```

Multi-value:

```http
GET /cases?status=open&status=under_review
```

atau:

```http
GET /cases?status=open,under_review
```

Pilih satu convention dan dokumentasikan.

Repeated parameter lebih natural secara URI/query parsing, tetapi comma-separated kadang lebih nyaman untuk client. Jangan campur tanpa alasan.

### 8.2 Sorting

Common pattern:

```http
GET /cases?sort=createdAt
GET /cases?sort=-createdAt
GET /cases?sort=status,-createdAt
```

Atau explicit:

```http
GET /cases?sortBy=createdAt&sortDirection=desc
```

Untuk API besar, pattern pertama compact. Pattern kedua lebih verbose tapi mudah divalidasi.

Backend harus allowlist field sort. Jangan langsung mapping query ke SQL/ORM property bebas.

Buruk:

```java
Sort.by(request.getParameter("sort"))
```

Jika tidak divalidasi, bisa mengekspos field internal atau membuat query mahal.

### 8.3 Pagination

Offset pagination:

```http
GET /cases?page=2&pageSize=50
```

atau:

```http
GET /cases?offset=100&limit=50
```

Cursor pagination:

```http
GET /cases?limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI2..."
```

Offset cocok untuk dataset kecil/stabil. Cursor cocok untuk dataset besar dan mutable.

URI implication:

- cursor adalah selection token, cocok di query;
- cursor harus opaque bagi client;
- jangan jadikan client bergantung pada struktur cursor;
- cursor jangan mengandung secret tanpa signing/encryption;
- sort order harus stabil.

### 8.4 Search

Simple search:

```http
GET /cases?q=reporting%20violation
```

Advanced search dengan banyak criteria bisa tetap query:

```http
GET /cases?status=open&entityType=bank&riskScoreMin=70
```

Tetapi jika query terlalu kompleks, pertimbangkan search resource:

```http
POST /case-searches
```

Body:

```json
{
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "createdAt": {
      "from": "2026-01-01",
      "to": "2026-06-01"
    },
    "riskScore": {
      "gte": 70
    }
  },
  "sort": [
    { "field": "riskScore", "direction": "desc" },
    { "field": "createdAt", "direction": "desc" }
  ],
  "pageSize": 50
}
```

Response bisa langsung search result atau create search job.

Trade-off:

| Search Style | Good For | Caution |
|---|---|---|
| `GET /cases?...` | simple filters, cacheable, bookmarkable | URL length, complexity |
| `POST /case-searches` | complex query object, saved searches, async | less naturally cacheable |
| `POST /cases/search` | common pragmatic style | action-like, but acceptable when documented |

### 8.5 Projection / Field Selection

```http
GET /cases?fields=id,status,createdAt
```

Useful for performance. But be careful:

- field names become public contract;
- authorization must apply per field if needed;
- caching varies by `fields`;
- observability high-cardinality risk if logged raw;
- client can become tightly coupled to representation internals.

### 8.6 Include / Expand

```http
GET /cases/C-123?include=assignees,evidenceSummary
```

or:

```http
GET /cases/C-123?expand=assignees
```

Good for reducing round trips. Risk:

- response shape variability;
- expensive joins;
- N+1 problems;
- accidental data leakage;
- cache fragmentation.

Backend must validate allowed includes and enforce authorization on expanded objects.

---

## 9. URI Stability and Evolution

URI is public contract. Treat it like a public class name plus method signature plus domain meaning.

### 9.1 Avoid Implementation Terms

Buruk:

```http
GET /caseDto/getById?id=123
GET /CaseController/findAll
GET /case-service/v2/cases
GET /oracle-cases/123
```

Lebih stabil:

```http
GET /cases/123
```

### 9.2 Avoid Temporary Organizational Names

Buruk:

```http
GET /new-enforcement-team/cases/123
GET /project-phoenix/cases/123
```

Organization changes faster than domain.

### 9.3 Avoid Exposing Database Primary Keys When Inappropriate

```http
GET /cases/982734
```

This can be fine, but consider:

- enumeration risk;
- migration risk;
- tenant leakage;
- audit readability;
- external reference requirements.

Often better:

```http
GET /cases/C-2026-000123
```

or public opaque ID:

```http
GET /cases/case_01JY4Q2F7ZP8Z9K9CQ6E7XQ5A7
```

### 9.4 Natural Key vs Surrogate Key

Natural key:

```http
GET /entities/registration-number/REG-998877
```

Surrogate key:

```http
GET /entities/ENT-123456
```

Natural keys can change or be sensitive. Surrogate public IDs are often safer.

A useful pattern:

```http
GET /entities/ENT-123456
GET /entity-lookups?registrationNumber=REG-998877
```

### 9.5 URI Migration

If URI changes, do not silently break.

Options:

- keep old URI as alias;
- use redirect if appropriate;
- include deprecation headers;
- document sunset;
- provide migration guide;
- avoid changing URI for internal refactor.

For APIs used by programmatic clients, redirects are not always followed safely for non-GET methods. Prefer compatibility layer for significant changes.

---

## 10. Versioning in URI vs Headers vs Media Types

API versioning is too large for one section; a later part covers it deeply. Here we focus on URI implications.

### 10.1 URI Versioning

```http
GET /v1/cases/C-123
GET /v2/cases/C-123
```

Pros:

- obvious;
- easy gateway routing;
- easy docs separation;
- easy client mental model.

Cons:

- version becomes part of resource identity appearance;
- can cause duplicate endpoints;
- encourages big-bang versions;
- not granular to representation only.

### 10.2 Header Versioning

```http
GET /cases/C-123
API-Version: 2026-06-01
```

Pros:

- URI stable;
- can evolve representation separately;
- cleaner resource model.

Cons:

- less visible;
- harder manual debugging;
- gateway/cache must vary correctly;
- tooling sometimes weaker.

### 10.3 Media Type Versioning

```http
Accept: application/vnd.example.case+json;version=2
```

Pros:

- aligns with representation negotiation;
- powerful for mature APIs.

Cons:

- more complex;
- harder for average clients;
- needs disciplined content negotiation.

### 10.4 Practical Guidance

For many backend teams:

```http
/v1/...
```

is acceptable if governance is clear.

But do not put every internal service version into the public URI.

Bad:

```http
/enforcement-case-query-service-v3/api/v2/case-read-models/123
```

Good:

```http
/v1/cases/123
```

Even better in some domains:

```http
/cases/123
Accept: application/vnd.example.case+json;version=2026-06-01
```

Use versioning to protect clients, not to expose internal release cycles.

---

## 11. Routing: Matching URI to Backend Handler

Routing is where external URI meets internal code.

In Spring MVC:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @GetMapping("/{caseId}")
    CaseResponse getCase(@PathVariable String caseId) {
        ...
    }

    @GetMapping
    CaseListResponse searchCases(
        @RequestParam Optional<String> status,
        @RequestParam Optional<String> assignedTo
    ) {
        ...
    }
}
```

### 11.1 Route Specificity

Ambiguous routes create production surprises.

Example:

```java
@GetMapping("/cases/{caseId}")
@GetMapping("/cases/search")
```

If not handled correctly, `/cases/search` may be interpreted as `caseId = "search"` depending on framework matching rules/configuration.

Better:

```http
GET /cases?...
```

or reserve explicit prefix:

```http
POST /case-searches
```

If you must use `/cases/search`, ensure route specificity and tests.

### 11.2 Static Segment vs Variable Segment

Prefer static segments for semantic separation:

```http
GET /cases/{caseId}/evidence
GET /cases/{caseId}/events
GET /cases/{caseId}/assignments
```

Avoid overloaded catch-all:

```java
@GetMapping("/cases/{caseId}/{anything}")
```

Catch-all route can hide invalid URIs and break 404 semantics.

### 11.3 Regex Constraints

Use path variable constraints when helpful.

Example:

```java
@GetMapping("/cases/{caseId:C-[0-9]{4}-[0-9]{6}}")
```

Benefits:

- invalid route rejected earlier;
- ambiguity reduced;
- better documentation of public ID format.

Cautions:

- regex can become too complex;
- changing ID format becomes breaking;
- regex performance must be safe;
- business validation still needed.

### 11.4 Trailing Slash

Are these the same?

```http
GET /cases
GET /cases/
```

Decide policy.

In many APIs, canonicalize one form. Inconsistent trailing slash behavior can break cache keys, route matching, auth rules, and generated links.

Recommended:

- choose no trailing slash for resource endpoints;
- redirect or reject consistently;
- configure gateway and app consistently;
- test both.

### 11.5 Case Sensitivity

URI path is generally case-sensitive at the syntax level. Do not rely on clients sending arbitrary casing.

Prefer lowercase path segments:

```http
/cases/{caseId}/evidence
```

not:

```http
/Cases/{caseId}/Evidence
```

IDs may be case-sensitive or case-insensitive depending on domain. Define it.

### 11.6 Dot, Slash, and Encoded Characters

IDs can contain tricky characters:

```text
abc.def
abc/def
abc%2Fdef
abc%252Fdef
```

Backend concerns:

- proxy may decode path before forwarding;
- framework may decode again;
- slash inside ID can break path segmentation;
- dot may interact with content negotiation or static resource handling;
- encoded path traversal risk;
- inconsistent normalization can cause authorization bypass.

Safer public IDs avoid reserved path characters.

Good ID alphabet examples:

```text
[A-Z0-9-]
[a-zA-Z0-9_-]
ULID/base32-style
UUID canonical format
```

Avoid IDs that require encoded slash in path. If unavoidable, use query or body.

---

## 12. URI Normalization and Security

Normalization is dangerous when different layers disagree.

Potential variants:

```text
/cases/C-123/evidence/E-1
/cases/C-123/evidence/./E-1
/cases/C-123/evidence/X/../E-1
/cases//C-123/evidence/E-1
/cases/%43-123/evidence/E-1
/cases/C-123/evidence/%45-1
```

If gateway authorizes one form but backend resolves another, security bugs appear.

### 12.1 Path Traversal

Classic dangerous endpoint:

```http
GET /files/{filename}
```

If filename is used as filesystem path:

```text
../../etc/passwd
```

or encoded variants:

```text
..%2F..%2Fetc%2Fpasswd
```

Defense:

- do not map URL path directly to filesystem path;
- use file IDs, not filenames, in URI;
- resolve canonical path and enforce base directory;
- reject path separators in IDs;
- validate after decoding exactly once;
- ensure proxy/framework decoding behavior is understood.

Better:

```http
GET /evidence-files/FILE-123/content
```

not:

```http
GET /download?path=/mnt/evidence/case123/report.pdf
```

### 12.2 Host Header Attacks

If backend generates links from request host:

```java
String resetLink = request.getScheme() + "://" + request.getHeader("Host") + "/reset?token=" + token;
```

An attacker might influence Host header if not validated.

Defense:

- configure allowed hosts;
- use canonical external base URL from config;
- trust forwarded host only from trusted proxy;
- do not build security-sensitive links from untrusted headers.

### 12.3 Open Redirect

Endpoint:

```http
GET /login?redirect=https://evil.example
```

Defense:

- allow only relative redirects;
- allowlist trusted domains;
- validate normalized target;
- do not trust double-encoded values;
- log rejected redirect attempts.

### 12.4 Cache Key Confusion

If proxy treats two URIs as different but app treats them as same, or vice versa, caching bugs can occur.

Examples:

```text
/cases/C-123
/cases/C-123/
/cases/%43-123
```

Canonicalization policy matters.

---

## 13. Authorization and URI Design

URI design affects authorization dramatically.

### 13.1 Object-Level Authorization

Endpoint:

```http
GET /cases/{caseId}
```

Backend must check:

```text
Can principal P view case C?
```

Not just:

```text
Does P have ROLE_CASE_VIEWER?
```

If URI includes tenant:

```http
GET /tenants/{tenantId}/cases/{caseId}
```

Backend must check:

```text
Can P access tenant T?
Does case C belong to tenant T?
Can P view case C within tenant T?
```

Do not assume path structure proves relationship. Verify it.

### 13.2 Parent-Child Consistency

Endpoint:

```http
GET /cases/C-123/evidence/E-999
```

Must verify:

```text
Evidence E-999 belongs to case C-123.
```

Otherwise attacker can do:

```http
GET /cases/C-123/evidence/E-from-other-case
```

and bypass checks if you only authorize case or only evidence incorrectly.

### 13.3 403 vs 404

For unauthorized resource:

```http
GET /cases/C-secret
```

Return 403 or 404?

Depends on disclosure policy.

- 403: caller authenticated but forbidden; reveals resource may exist.
- 404: hides existence; useful for sensitive objects.

But be consistent. In regulatory systems, existence of an investigation can be sensitive, so 404-for-hidden-resource may be defensible. But logs/audit should record actual authorization failure internally.

### 13.4 URI Does Not Replace Policy

Bad assumption:

```text
If user can access /users/{userId}/cases, then all cases returned are allowed.
```

Backend still needs query-level authorization filtering.

Example:

```http
GET /cases?assignedTo=U-999
```

The caller may not be allowed to search other users' assigned cases. Query parameters are also authorization input.

---

## 14. Observability and URI Design

Metrics systems should not label every raw URI.

Bad metric label:

```text
http.server.duration{path="/cases/C-2026-000123/evidence/E-9981"}
```

High cardinality explosion.

Better:

```text
http.server.duration{route="/cases/{caseId}/evidence/{evidenceId}", method="GET", status="200"}
```

### 14.1 Route Template as Observability Dimension

Backend should emit route template, not raw path, for metrics.

Good logs can include both:

```json
{
  "method": "GET",
  "path": "/cases/C-2026-000123/evidence/E-9981",
  "route": "/cases/{caseId}/evidence/{evidenceId}",
  "status": 200,
  "correlationId": "req-abc"
}
```

Metrics should usually use route template.

### 14.2 Endpoint Design Affects Incident Diagnosis

Compare:

```http
POST /process
```

versus:

```http
POST /cases/{caseId}/legal-review-requests
POST /cases/{caseId}/escalation-requests
POST /cases/{caseId}/closure-records
```

The second makes dashboards more meaningful:

- which operation is failing;
- which operation is slow;
- which operation spikes after release;
- which operation gets rate-limited;
- which operation has high conflict rate.

### 14.3 Logging Query Parameters

Do not log raw query parameters blindly.

Risky:

```http
GET /cases?q=John%20Doe%20passport%201234
```

Query can contain personal data or sensitive case terms.

Policy:

- log route template;
- log allowlisted query keys;
- redact sensitive values;
- avoid logging full search text unless justified;
- separate audit logs from operational logs.

---

## 15. API Gateway and Reverse Proxy Implications

URI design is not only application code. Gateway/proxy sees URI first.

### 15.1 Prefix Routing

Gateway may route:

```text
/api/cases/**       -> case-service
/api/evidence/**    -> evidence-service
/api/exports/**     -> export-service
```

Public URI may include `/api`, or gateway may strip it.

Be careful with path rewriting:

```text
external: /api/cases/C-123
internal: /cases/C-123
```

Issues:

- generated links may use internal path accidentally;
- redirect Location header may leak internal route;
- OpenAPI docs may mismatch runtime;
- security rules at gateway/app may refer to different paths.

### 15.2 Gateway Auth Rules

Gateway might enforce:

```text
/cases/** requires token
/admin/** requires admin scope
```

If app also has routes:

```text
/case-admin/**
/cases/{caseId}/admin-notes
```

Policy can drift.

Best practice:

- centralize coarse edge policies;
- keep fine-grained object authorization in app/domain;
- test gateway and app route alignment;
- avoid wildcard rules that unintentionally expose new endpoints.

### 15.3 Path Normalization at Proxy

Proxy might normalize:

```text
//
/./
/../
%2F
```

App might not. Or vice versa.

Security posture requires consistency.

### 15.4 Backend Service Name Should Not Be Public Contract

Bad public API:

```http
GET /case-query-service/cases/C-123
POST /case-command-service/cases/C-123/assign
```

Service boundaries change. Domain contract should be stable.

Better public API:

```http
GET /cases/C-123
POST /cases/C-123/assignments
```

Internally, gateway can route to query/command services.

---

## 16. Java/Spring URI Design and Routing Patterns

### 16.1 Basic Controller Structure

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseApplicationService cases;

    CaseController(CaseApplicationService cases) {
        this.cases = cases;
    }

    @GetMapping("/{caseId}")
    CaseResponse getCase(@PathVariable CaseId caseId) {
        return cases.getCase(caseId);
    }

    @GetMapping
    CaseSearchResponse searchCases(CaseSearchRequest request) {
        return cases.searchCases(request);
    }

    @PostMapping
    ResponseEntity<CaseResponse> createCase(@Valid @RequestBody CreateCaseRequest request) {
        CaseResponse created = cases.createCase(request);
        URI location = URI.create("/cases/" + created.id());
        return ResponseEntity.created(location).body(created);
    }
}
```

### 16.2 Typed ID Conversion

Instead of passing raw strings everywhere:

```java
record CaseId(String value) {
    CaseId {
        if (!value.matches("C-[0-9]{4}-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid case id");
        }
    }
}
```

Then configure converter:

```java
@Component
class CaseIdConverter implements Converter<String, CaseId> {
    @Override
    public CaseId convert(String source) {
        return new CaseId(source);
    }
}
```

Controller:

```java
@GetMapping("/cases/{caseId}")
CaseResponse getCase(@PathVariable CaseId caseId) {
    return service.getCase(caseId);
}
```

Benefits:

- validation centralized;
- method signatures clearer;
- fewer primitive obsession bugs;
- domain language stronger.

Caution: syntactic ID validation is not authorization or existence check.

### 16.3 Avoid Controller God Object

Bad:

```java
@RestController
@RequestMapping("/cases")
class CaseController {
    @PostMapping("/{id}/submit") ...
    @PostMapping("/{id}/approve") ...
    @PostMapping("/{id}/reject") ...
    @PostMapping("/{id}/assign") ...
    @PostMapping("/{id}/upload") ...
    @PostMapping("/{id}/comment") ...
    @PostMapping("/{id}/notify") ...
    @PostMapping("/{id}/archive") ...
}
```

Better group by resource/operation area:

```java
@RestController
@RequestMapping("/cases/{caseId}/submissions")
class CaseSubmissionController { ... }

@RestController
@RequestMapping("/cases/{caseId}/decisions")
class CaseDecisionController { ... }

@RestController
@RequestMapping("/cases/{caseId}/assignments")
class CaseAssignmentController { ... }

@RestController
@RequestMapping("/cases/{caseId}/evidence")
class CaseEvidenceController { ... }
```

This aligns code ownership with API resources.

### 16.4 Query Object Binding

```java
record CaseSearchRequest(
    Optional<CaseStatus> status,
    Optional<UserId> assignedTo,
    Optional<Instant> createdFrom,
    Optional<Instant> createdTo,
    int pageSize,
    Optional<String> cursor
) {}
```

Controller:

```java
@GetMapping("/cases")
CaseSearchResponse search(CaseSearchRequest request) {
    return service.search(request);
}
```

But validate:

- max page size;
- allowed sort fields;
- mutually exclusive parameters;
- date range sanity;
- authorization constraints;
- expensive query limits.

### 16.5 Route Tests

Do not test only controller logic. Test route matching behavior.

Examples:

```text
GET /cases/search should not be treated as /cases/{caseId}
GET /cases/C-2026-000123 should match getCase
GET /cases/C-2026-000123/ should follow canonical policy
GET /cases/%2F should be rejected
GET /cases/C-2026-000123/evidence/E-1 should verify relationship
```

Use MockMvc/WebTestClient plus integration tests behind proxy if possible.

---

## 17. Designing URI for Regulatory Case Management

Let's build a concrete model.

### 17.1 Domain Concepts

```text
Case
Evidence
Attachment/File
Assignment
Review
Decision
Escalation
Comment
Audit Event
Export
Notification
Participant
Respondent
```

### 17.2 First Draft URI Model

```http
GET  /cases
POST /cases
GET  /cases/{caseId}
PATCH /cases/{caseId}

GET  /cases/{caseId}/evidence
POST /cases/{caseId}/evidence
GET  /cases/{caseId}/evidence/{evidenceId}
DELETE /cases/{caseId}/evidence/{evidenceId}

GET  /cases/{caseId}/assignments
POST /cases/{caseId}/assignments
DELETE /cases/{caseId}/assignments/{assignmentId}

GET  /cases/{caseId}/reviews
POST /cases/{caseId}/reviews
GET  /cases/{caseId}/reviews/{reviewId}

GET  /cases/{caseId}/decisions
POST /cases/{caseId}/decisions
GET  /cases/{caseId}/decisions/{decisionId}

GET  /cases/{caseId}/events
GET  /cases/{caseId}/audit-records
```

### 17.3 Evidence File Handling

Option A:

```http
GET /cases/{caseId}/evidence/{evidenceId}/file
```

Option B:

```http
GET /evidence-files/{fileId}/content
```

Choose based on identity and authorization.

If file is only meaningful as evidence in a case, Option A is clear. If file service manages files globally and a file can be attached to many resources, Option B may be better, but authorization must check resource relationship.

### 17.4 Assignment Design

Bad:

```http
POST /cases/{caseId}/assign?userId=U-123
```

Better:

```http
POST /cases/{caseId}/assignments
Content-Type: application/json

{
  "assigneeId": "U-123",
  "role": "LEAD_INVESTIGATOR",
  "reason": "Domain expertise in reporting violations"
}
```

Response:

```http
201 Created
Location: /cases/C-123/assignments/A-456
```

### 17.5 Decision Design

Bad:

```http
POST /cases/{caseId}/approve
POST /cases/{caseId}/reject
```

Better:

```http
POST /cases/{caseId}/decisions
Content-Type: application/json

{
  "outcome": "VIOLATION_CONFIRMED",
  "sanctionRecommendation": "MONETARY_PENALTY",
  "reasonCodes": ["EVIDENCE_SUFFICIENT", "PRIOR_WARNING_IGNORED"],
  "summary": "The respondent failed to submit required reports after notice."
}
```

Why:

- decision has legal meaning;
- decision should be immutable or append-only;
- decision may need revision process;
- decision has actor and timestamp;
- decision can be appealed;
- decision can be audited.

### 17.6 Escalation Design

```http
POST /cases/{caseId}/escalation-requests
```

Response options:

```http
201 Created
Location: /cases/C-123/escalation-requests/ER-1
```

or if asynchronous:

```http
202 Accepted
Location: /operations/OP-9
```

If escalation request itself is persisted immediately, `201` is natural. If backend only accepted work to later create an escalation, `202` with operation resource may be better.

---

## 18. URI Design Anti-Patterns

### 18.1 Verb Soup

```http
POST /createCase
POST /updateCase
POST /deleteCase
POST /getCase
```

Fix:

```http
POST   /cases
PATCH  /cases/{caseId}
DELETE /cases/{caseId}
GET    /cases/{caseId}
```

### 18.2 Everything Is POST

```http
POST /cases/get
POST /cases/search
POST /cases/delete
POST /cases/update
```

Sometimes necessary behind restrictive clients, but usually bad because it discards HTTP semantics.

### 18.3 Path as Query Language

```http
GET /cases/status/open/priority/high/assigned/U-123/sort/createdAt/desc
```

Fix:

```http
GET /cases?status=open&priority=high&assignedTo=U-123&sort=-createdAt
```

### 18.4 Database Leakage

```http
GET /tbl_case_header/123
GET /case_rows/123/evidence_rows/456
```

Fix:

```http
GET /cases/C-123/evidence/E-456
```

### 18.5 Microservice Leakage

```http
GET /case-query-service/cases/123
POST /case-command-service/commands/approveCase
```

Fix public contract:

```http
GET /cases/123
POST /cases/123/decisions
```

### 18.6 Ambiguous Plurals and Singulars

Inconsistent:

```http
GET /case/123
GET /cases
POST /case
GET /evidence/123
GET /evidences
```

Use consistent plural collection names:

```http
GET /cases/123
GET /cases
GET /evidence-items/123
```

Note: `evidence` is often uncountable in English. For API clarity, choose `evidence` as collection or use `evidence-items`. Consistency matters more than grammar perfection.

### 18.7 Public URI with Internal Status Names

```http
GET /cases/in_status_7
```

Fix:

```http
GET /cases?status=under_review
```

or stable public enum:

```http
GET /cases?status=UNDER_REVIEW
```

### 18.8 Security Through Path Obscurity

```http
GET /admin-secret-928374/cases
```

Bad. Use proper authentication and authorization.

### 18.9 Unbounded Catch-All

```java
@GetMapping("/{type}/{id}/{action}")
```

This creates hidden RPC framework inside HTTP. It weakens validation, documentation, metrics, and security.

---

## 19. URI Review Heuristics for Senior Backend Engineers

When reviewing an API proposal, ask:

### 19.1 Resource Clarity

- What resource does this URI identify?
- Is it an entity, collection, relationship, view, operation, or report?
- Can we explain it without mentioning controller/service/table?

### 19.2 Identity

- Which path variables are part of identity?
- Are IDs stable public identifiers?
- Are parent-child relationships real and stable?
- Are we leaking database/internal IDs unnecessarily?

### 19.3 Method Fit

- Does method semantics match operation?
- Is mutation hidden behind GET?
- Are idempotent operations modeled correctly?
- Can retries cause duplicate effects?

### 19.4 Query Semantics

- Are filters in query, not path?
- Are query parameters validated and allowlisted?
- Is pagination stable?
- Is search complexity manageable?

### 19.5 Authorization

- What object-level checks are required?
- Does every path variable get relationship validation?
- Can query parameters widen access unexpectedly?
- Does URI reveal sensitive existence?

### 19.6 Routing

- Are routes ambiguous?
- Are static paths protected from variable capture?
- Is trailing slash policy defined?
- Are encoded slash/dot/semicolon behaviors understood?

### 19.7 Evolution

- Can this URI survive internal refactor?
- Is versioning strategy clear?
- Are domain terms stable?
- Are we exposing temporary organization/project names?

### 19.8 Observability

- Can metrics use route templates?
- Is operation-specific visibility good?
- Are raw query values safe to log?
- Will dashboards be meaningful?

### 19.9 Gateway/Proxy

- Does gateway route match app route?
- Are rewritten paths handled correctly?
- Are host and forwarded headers trusted safely?
- Are edge and app auth policies consistent?

---

## 20. Worked Example: Redesign a Poor API

Initial API:

```http
POST /caseService/getCase
POST /caseService/searchCases
POST /caseService/updateStatus
POST /caseService/assignUser
POST /caseService/uploadEvidence
POST /caseService/downloadEvidence
POST /caseService/approve
```

Problems:

- service name exposed;
- everything is POST;
- no resource identity in URI;
- operations are verbs without result resources;
- weak cacheability;
- poor observability;
- authorization rules likely buried in body;
- hard to reason about retry/idempotency;
- no stable location for created resources.

Redesigned API:

```http
GET  /cases/{caseId}
GET  /cases?status=open&assignedTo=U-123
PATCH /cases/{caseId}

POST /cases/{caseId}/assignments
GET  /cases/{caseId}/assignments
DELETE /cases/{caseId}/assignments/{assignmentId}

POST /cases/{caseId}/evidence
GET  /cases/{caseId}/evidence
GET  /cases/{caseId}/evidence/{evidenceId}
GET  /cases/{caseId}/evidence/{evidenceId}/file

POST /cases/{caseId}/decisions
GET  /cases/{caseId}/decisions
GET  /cases/{caseId}/decisions/{decisionId}
```

Now:

- resource model visible;
- assignments and decisions have identity;
- search uses query;
- evidence upload creates subordinate resource;
- file download is retrieval;
- status transitions become auditable resources;
- route metrics become meaningful;
- authorization can be organized per resource.

---

## 21. Practical Naming Conventions

### 21.1 Use Lowercase Path Segments

```http
/cases/{caseId}/legal-review-requests
```

Avoid:

```http
/Cases/{caseId}/LegalReviewRequests
```

### 21.2 Use Hyphen for Multi-Word Segments

```http
/legal-review-requests
/audit-records
/risk-assessments
```

Avoid inconsistent mix:

```http
/legalReviewRequests
/legal_review_requests
/legal-reviewRequests
```

### 21.3 Use Plural Collection Names

```http
/cases
/cases/{caseId}/assignments
/cases/{caseId}/decisions
```

### 21.4 Avoid File Extensions for API Resources

Usually prefer negotiation:

```http
GET /cases/C-123
Accept: application/json
```

not:

```http
GET /cases/C-123.json
```

But file downloads may naturally include filename in `Content-Disposition`, not necessarily URI.

### 21.5 Keep URI Human-Readable but Not Overly Semantic

Good:

```http
/cases/C-2026-000123
```

Too much:

```http
/cases/2026/enforcement/reporting-violation/high-priority/respondent-bank-abc/C-2026-000123
```

Attributes belong in representation/query, not always path.

---

## 22. Decision Framework: Designing a New Endpoint

Use this step-by-step method.

### Step 1: Name the Domain Concept

What is the business/domain thing?

```text
Case assignment
Evidence file
Legal review request
Enforcement decision
Export job
```

### Step 2: Decide Resource Type

Is it:

- collection?
- item?
- relationship?
- operation/task?
- view/report?
- search result?

### Step 3: Decide Identity

Does it have stable identity?

```text
Assignment A-1
Decision D-9
Export EX-7
```

If yes, expose item URI.

### Step 4: Decide Parent Context

Does it belong under another resource?

```http
/cases/{caseId}/assignments/{assignmentId}
```

or global?

```http
/assignments/{assignmentId}
```

### Step 5: Decide Method

- retrieve -> GET;
- create subordinate -> POST collection;
- replace -> PUT item;
- partial update -> PATCH item;
- remove/cancel relationship -> DELETE item;
- async command -> POST operation/task resource.

### Step 6: Decide Parameters

- identity -> path;
- filter/sort/page/projection -> query;
- command data -> body;
- auth/tracing/negotiation -> headers.

### Step 7: Define Authorization Checks

For each path/query/body field, ask:

- can caller reference this ID?
- can caller perform this action?
- does child belong to parent?
- does tenant match principal?

### Step 8: Define Response and Location

For create:

```http
201 Created
Location: /cases/C-123/assignments/A-1
```

For async:

```http
202 Accepted
Location: /operations/OP-1
```

### Step 9: Define Observability Route Template

```text
POST /cases/{caseId}/assignments
```

### Step 10: Test Edge Cases

- invalid ID format;
- non-existing ID;
- unauthorized ID;
- child under wrong parent;
- trailing slash;
- encoded slash;
- route collision;
- gateway rewrite;
- query parameter abuse.

---

## 23. Checklist: Production-Grade URI Design

Before approving an endpoint, verify:

```text
[ ] URI describes resource, not controller/service/table.
[ ] Path variables represent identity or stable hierarchy.
[ ] Query parameters represent filter/sort/page/projection/modifiers.
[ ] No secret appears in path/query.
[ ] Route has no ambiguity with static segments.
[ ] Trailing slash behavior is defined.
[ ] Path encoding/normalization behavior is understood.
[ ] IDs avoid problematic reserved characters.
[ ] Parent-child relationship is validated server-side.
[ ] Object-level authorization is explicit.
[ ] Query parameters cannot bypass authorization.
[ ] Gateway route and app route are aligned.
[ ] Metrics use route template, not raw URI.
[ ] Raw query logging is redacted/controlled.
[ ] URI can survive internal refactor.
[ ] Domain terms are stable and meaningful.
[ ] Async operations expose operation/status resource.
[ ] Important workflow decisions are modeled as resources when audit matters.
[ ] Created resources return Location where appropriate.
[ ] OpenAPI documentation matches actual route behavior.
[ ] Tests cover invalid, ambiguous, encoded, unauthorized, and wrong-parent paths.
```

---

## 24. Exercises

### Exercise 1: Refactor Verb Endpoints

Refactor this API:

```http
POST /createInvestigation
POST /assignInvestigator
POST /submitEvidence
POST /approveInvestigation
POST /closeInvestigation
POST /getInvestigationHistory
```

Design resource-oriented alternatives.

Expected direction:

```http
POST /investigations
POST /investigations/{investigationId}/assignments
POST /investigations/{investigationId}/evidence
POST /investigations/{investigationId}/decisions
POST /investigations/{investigationId}/closure-records
GET  /investigations/{investigationId}/events
```

### Exercise 2: Path or Query?

Classify each parameter as path/query/body/header:

```text
caseId
status
assignedTo
pageSize
cursor
tenantId
idempotencyKey
decisionReason
accessToken
sort
fields
```

Suggested answer:

```text
caseId          -> path
status          -> query
assignedTo      -> query, unless assignment resource identity
pageSize        -> query
cursor          -> query
tenantId        -> path/host/header depending architecture, never blindly trusted
aidempotencyKey -> header
decisionReason  -> body
accessToken     -> Authorization header
sort            -> query
fields          -> query
```

### Exercise 3: Find Authorization Risks

Endpoint:

```http
GET /tenants/{tenantId}/cases/{caseId}/evidence/{evidenceId}
```

What must backend verify?

Answer:

```text
1. Authenticated principal exists.
2. Principal can access tenantId.
3. caseId belongs to tenantId.
4. Principal can view caseId.
5. evidenceId belongs to caseId.
6. Principal can view evidenceId.
7. Evidence classification does not exceed principal clearance.
8. Response redacts fields if needed.
9. Audit records access if domain requires.
```

### Exercise 4: Search API Design

Design API for advanced case search with 20 filters, full-text query, date ranges, and export option.

Possible answer:

```http
POST /case-searches
GET  /case-searches/{searchId}
GET  /case-searches/{searchId}/results?cursor=...
POST /case-searches/{searchId}/exports
GET  /exports/{exportId}
```

This models complex search and export as resources.

---

## 25. Key Takeaways

1. URI is external resource identity; route is internal implementation mapping.
2. Path should primarily express identity and stable hierarchy.
3. Query should express filtering, sorting, pagination, projection, and optional selection modifiers.
4. Resource does not have to be database row; it can be relationship, view, decision, operation, search, or report.
5. Workflow-heavy systems benefit from modeling important transitions as resources.
6. Avoid exposing service names, controller names, database tables, and temporary organization names.
7. Routing ambiguity is a correctness and security risk, not only a framework annoyance.
8. URI normalization differences across proxy, gateway, and app can create security bugs.
9. Authorization must verify every referenced object and relationship; URI hierarchy is not proof.
10. Observability should use route templates, not raw high-cardinality paths.
11. Good URI design makes backend systems easier to secure, operate, evolve, and audit.

---

## 26. References

- RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax.
- RFC 9110 — HTTP Semantics.
- Spring Framework Reference — Mapping Requests and URI patterns.
- Spring Framework API — `PathPattern` and `PathPatternParser`.
- OWASP API Security Top 10 — especially Broken Object Level Authorization, Broken Function Level Authorization, and injection-related risks.

---

## 27. What Comes Next

Next file:

```text
learn-http-for-web-backend-perspective-part-008.md
```

Topic:

```text
Content Negotiation and Representation Design
```

Part berikutnya akan membahas perbedaan resource vs representation secara lebih dalam, media type, `Accept`, `Content-Type`, JSON/XML/CSV/PDF/NDJSON/protobuf, message converters di Spring, backward-compatible DTO evolution, dan bagaimana backend memilih representation yang benar tanpa mencampur domain model dengan wire contract.

---

## Series Progress

```text
[x] Part 000 — Orientation: HTTP Backend Mental Model
[x] Part 001 — HTTP Semantics from Server Point of View
[x] Part 002 — Request Lifecycle: From Socket to Controller
[x] Part 003 — Methods Deep Dive for Backend Correctness
[x] Part 004 — Status Codes as Backend State Contracts
[x] Part 005 — Headers as Backend Control Plane
[x] Part 006 — Request Body, Response Body, and Message Framing
[x] Part 007 — URI, Routing, and Resource Modeling
[ ] Part 008 — Content Negotiation and Representation Design
[ ] Part 009 — Validation, Parsing, and Defensive Boundaries
[ ] Part 010 — Error Response Design and Problem Details
[ ] Part 011 — Idempotency, Retries, and Exactly-Once Illusions
[ ] Part 012 — Conditional Requests and Optimistic Concurrency
[ ] Part 013 — Caching for Backend Engineers
[ ] Part 014 — Authentication over HTTP
[ ] Part 015 — Authorization and Resource-Level Security
[ ] Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend
[ ] Part 017 — CORS from Backend Enforcement Perspective
[ ] Part 018 — Rate Limiting, Quotas, and Abuse Control
[ ] Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding
[ ] Part 020 — File Upload, Download, Multipart, and Large Payloads
[ ] Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses
[ ] Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers
[ ] Part 023 — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries
[ ] Part 024 — API Design Styles over HTTP
[ ] Part 025 — API Versioning and Evolution
[ ] Part 026 — Observability: Logs, Metrics, Traces, and HTTP Diagnostics
[ ] Part 027 — Security Headers and HTTP Hardening
[ ] Part 028 — HTTP Attacks and Defensive Backend Design
[ ] Part 029 — Java Backend Implementation: Servlet, Spring MVC, Filters, Interceptors
[ ] Part 030 — Java Backend Implementation: WebFlux, Reactor Netty, and Reactive HTTP
[ ] Part 031 — Backend-to-Backend HTTP Clients
[ ] Part 032 — Capstone: Designing a Production-Grade HTTP API
```

Seri belum selesai. Kita baru menyelesaikan Part 007 dari 032.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-006.md">⬅️ Part 006 — Request Body, Response Body, and Message Framing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-008.md">Part 008 — Content Negotiation and Representation Design ➡️</a>
</div>
