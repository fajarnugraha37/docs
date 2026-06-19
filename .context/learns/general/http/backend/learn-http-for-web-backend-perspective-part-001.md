# learn-http-for-web-backend-perspective-part-001.md

# Part 001 — HTTP Semantics from Server Point of View

> Series: **HTTP for Web/Backend Perspective**  
> Audience: **Java software engineer / backend engineer**  
> Focus: **HTTP semantics as server-side correctness contract**  
> Status: **Part 001 of 032**

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membangun orientasi: backend HTTP bukan sekadar `@RestController`, bukan sekadar menerima JSON lalu mengembalikan JSON, dan bukan sekadar memilih status code yang “kelihatannya cocok”.

Di part ini kita mulai masuk ke fondasi paling penting: **HTTP semantics dari sudut pandang server**.

Inti yang ingin dicapai:

1. Kamu memahami bahwa HTTP adalah **semantic protocol**.
2. Kamu bisa membedakan **resource**, **representation**, **selected representation**, **state**, dan **operation**.
3. Kamu bisa memilih HTTP method berdasarkan sifat operasi, bukan berdasarkan kebiasaan tim.
4. Kamu memahami efek pilihan method/status/header terhadap:
   - retry,
   - caching,
   - concurrency,
   - auditability,
   - security,
   - observability,
   - evolusi API.
5. Kamu mulai melihat API backend sebagai **public contract** yang memiliki invariants, bukan hanya function call jarak jauh.

Part ini sengaja tidak berisi terlalu banyak Spring code dulu. Kita akan menyentuh Java/Spring secukupnya, tetapi target utama adalah mental model. Implementasi akan jauh lebih mudah jika semantics-nya benar.

---

## 1. Kenapa Backend Engineer Harus Serius Memahami Semantics

Banyak backend engineer memakai HTTP seperti ini:

```http
POST /getUser
POST /createOrder
POST /updateOrder
POST /deleteOrder
```

Lalu semua response dibungkus seperti ini:

```json
{
  "success": true,
  "code": "SUCCESS",
  "data": { }
}
```

Atau saat error:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Invalid input"
}
```

Dengan status HTTP tetap:

```http
HTTP/1.1 200 OK
```

Secara teknis, ini bisa “jalan”. Tetapi secara HTTP semantics, desain seperti ini membuang banyak kemampuan protokol:

- cache tidak tahu response mana yang boleh disimpan,
- client tidak tahu request mana yang aman untuk retry,
- gateway tidak bisa membedakan client error vs server error,
- monitoring menjadi kabur,
- security policy sulit diterapkan konsisten,
- distributed failure menjadi sulit dianalisis,
- API sulit berevolusi karena semua operasi menjadi opaque command.

HTTP bukan hanya envelope. HTTP membawa makna.

Spesifikasi HTTP modern memisahkan **semantics** dari detail wire protocol. Artinya, makna method, status code, header, representation, dan URI berlaku lintas HTTP/1.1, HTTP/2, dan HTTP/3. RFC 9110 mendefinisikan semantics umum HTTP; RFC 9112 membahas HTTP/1.1 message syntax/routing; RFC 9113 membahas HTTP/2; RFC 9114 membahas HTTP/3.

Sebagai backend engineer, ini penting karena aplikasi kamu mungkin berbicara:

```text
Client -> CDN -> WAF -> API Gateway -> Load Balancer -> Service Mesh -> Java App
```

Di setiap hop, semantics HTTP bisa dipakai untuk mengambil keputusan. Kalau semantics dari server kacau, seluruh chain di atas kehilangan sinyal.

---

## 2. Mental Model Utama: HTTP Bukan Remote Method Invocation

Kesalahan paling umum adalah melihat HTTP endpoint sebagai function call:

```java
approveCase(caseId, reviewerId, comment)
```

Lalu diterjemahkan menjadi:

```http
POST /approveCase
```

Ini mental model RPC murni. RPC tidak salah. Tetapi jika kamu memilih HTTP API resource-oriented, kamu perlu berpikir berbeda.

HTTP lebih dekat ke model ini:

```text
Client menyatakan intensi terhadap resource melalui method tertentu,
server memilih atau mengubah state,
lalu server mengembalikan representation/status/metadata yang menjelaskan hasilnya.
```

Bukan:

```text
Client memanggil method Java remote,
server menjalankan function,
server mengembalikan return value.
```

Perbedaannya penting.

### 2.1 Function Call Thinking

Contoh domain enforcement case:

```java
approveCase(caseId)
escalateCase(caseId)
assignInvestigator(caseId, investigatorId)
requestEvidence(caseId, respondentId)
closeCase(caseId)
```

Jika diterjemahkan mentah ke HTTP:

```http
POST /approveCase
POST /escalateCase
POST /assignInvestigator
POST /requestEvidence
POST /closeCase
```

Masalah:

1. URI berisi verb, bukan resource identity.
2. Method tidak memberi tahu sifat operasi.
3. Tidak jelas mana yang idempotent.
4. Tidak jelas resource apa yang berubah.
5. Sulit membuat conditional update.
6. Sulit audit state transition.
7. Sulit mendesain cache/authorization secara resource-level.

### 2.2 Resource-Oriented Thinking

Alternatif:

```http
GET    /cases/{caseId}
PATCH  /cases/{caseId}
POST   /cases/{caseId}/assignments
POST   /cases/{caseId}/escalations
POST   /cases/{caseId}/evidence-requests
PUT    /cases/{caseId}/decision
DELETE /cases/{caseId}/assignment/{assignmentId}
```

Atau untuk workflow tertentu:

```http
POST /cases/{caseId}/transitions
```

Dengan body:

```json
{
  "transition": "APPROVE",
  "comment": "Evidence reviewed and sufficient."
}
```

Ini belum otomatis benar, tetapi lebih eksplisit:

- `case` adalah resource utama,
- `assignment` adalah resource turunan,
- `escalation` adalah event/command resource,
- `decision` mungkin single sub-resource,
- `transition` bisa dimodelkan sebagai command/event resource.

HTTP tidak memaksa semua API harus REST murni. Tetapi HTTP semantics membantu kamu membuat kontrak yang bisa dipahami oleh client, gateway, cache, proxy, log pipeline, dan manusia.

---

## 3. Lima Istilah yang Harus Dipegang

Untuk backend HTTP, lima istilah ini harus jelas:

1. **Resource**
2. **Resource state**
3. **Representation**
4. **Selected representation**
5. **Operation semantics**

Mari bedah satu per satu.

---

## 4. Resource

**Resource** adalah target konseptual yang diidentifikasi oleh URI.

Contoh:

```http
/cases/CASE-2026-0001
```

Resource di sini bukan otomatis row database. Resource adalah sesuatu yang bisa diberi nama dan diakses melalui HTTP.

Resource bisa berupa:

- entity domain,
- collection,
- projection,
- relationship,
- process,
- command endpoint,
- report,
- search result,
- file,
- status monitor,
- async job,
- event stream.

Contoh resource:

```http
/cases
/cases/CASE-2026-0001
/cases/CASE-2026-0001/evidence
/cases/CASE-2026-0001/assignments
/cases/CASE-2026-0001/decision
/cases/CASE-2026-0001/audit-events
/reports/enforcement-summary?year=2026
/exports/EXP-9932/status
```

### 4.1 Resource Tidak Harus Sama dengan Table

Misalnya database kamu:

```text
case_table
case_assignment_table
evidence_table
user_table
case_status_history_table
```

Resource API kamu tidak harus 1:1:

```http
/cases/{id}
```

Response-nya bisa menggabungkan:

- case core data,
- current assignment,
- current status,
- allowed actions,
- evidence summary,
- latest deadline.

Resource adalah **kontrak eksternal**. Database adalah **model internal**.

Backend top-tier tidak mengekspos internal persistence model mentah sebagai API model. Mereka membuat resource model yang stabil, aman, dan sesuai kebutuhan client.

### 4.2 Resource Bisa Berupa Collection

```http
GET /cases
```

Resource `/cases` adalah collection resource. Ia bisa menerima query parameter:

```http
GET /cases?status=OPEN&assignedTo=u123&sort=-createdAt&page=1&pageSize=50
```

Resource collection bukan “function searchCases”. Ia tetap resource: representasi dari himpunan case sesuai filter.

### 4.3 Resource Bisa Berupa Relationship

```http
PUT /cases/{caseId}/watchers/{userId}
DELETE /cases/{caseId}/watchers/{userId}
```

Di sini relationship “user X watches case Y” bisa dimodelkan sebagai resource.

Ini berguna karena relationship sering punya lifecycle, authorization, audit, dan idempotency sendiri.

### 4.4 Resource Bisa Berupa Command/Transition

Tidak semua domain nyaman dimodelkan sebagai CRUD.

Regulatory workflow sering punya state transition:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ESCALATED -> DECIDED -> CLOSED
```

Kamu bisa modelkan transisi sebagai resource event/command:

```http
POST /cases/{caseId}/transitions
```

Body:

```json
{
  "type": "ESCALATE",
  "reason": "Potential systemic violation",
  "targetUnit": "LEGAL_REVIEW"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-2026-0001/transitions/TRN-8821
```

Ini bukan REST purist CRUD, tetapi masih HTTP-aware:

- request membuat transition resource,
- transition punya identity,
- bisa diaudit,
- bisa dicegah duplikasinya dengan idempotency key,
- bisa dikembalikan sebagai representation.

---

## 5. Resource State

**Resource state** adalah kondisi aktual resource di server.

Contoh state internal case:

```json
{
  "id": "CASE-2026-0001",
  "status": "UNDER_REVIEW",
  "assignedInvestigatorId": "USR-991",
  "version": 7,
  "deadline": "2026-07-15",
  "riskScore": 84,
  "lastUpdatedAt": "2026-06-18T10:15:00Z"
}
```

State ini bisa tersimpan di:

- PostgreSQL,
- Kafka compacted topic,
- event store,
- MongoDB,
- Redis,
- distributed aggregate,
- external system.

HTTP client tidak perlu tahu semua itu.

Yang client lihat adalah representation.

---

## 6. Representation

**Representation** adalah bentuk data yang dikirim lewat HTTP untuk mewakili resource state.

Satu resource bisa punya banyak representation.

Resource:

```http
/cases/CASE-2026-0001
```

Representasi JSON:

```http
GET /cases/CASE-2026-0001
Accept: application/json
```

```json
{
  "id": "CASE-2026-0001",
  "status": "UNDER_REVIEW",
  "assignedInvestigator": {
    "id": "USR-991",
    "displayName": "A. Rahman"
  },
  "links": {
    "self": "/cases/CASE-2026-0001",
    "evidence": "/cases/CASE-2026-0001/evidence",
    "auditEvents": "/cases/CASE-2026-0001/audit-events"
  }
}
```

Representasi PDF:

```http
GET /cases/CASE-2026-0001
Accept: application/pdf
```

Representasi ringkas:

```http
GET /cases/CASE-2026-0001
Accept: application/vnd.acme.case-summary+json
```

Representasi machine-to-machine:

```http
GET /cases/CASE-2026-0001
Accept: application/vnd.acme.case.v2+json
```

### 6.1 Representation Bukan Domain Object

Kesalahan umum Java backend:

```java
@Entity
class CaseEntity { ... }
```

langsung dijadikan:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable String id) { ... }
```

Ini buruk karena:

1. Persistence structure bocor ke API.
2. Lazy loading bisa meledakkan response.
3. Field internal bisa terekspos.
4. Perubahan database menjadi breaking API change.
5. Authorization field-level sulit.
6. Representation tidak didesain untuk client contract.

Lebih sehat:

```java
record CaseResponse(
    String id,
    String status,
    InvestigatorSummary assignedInvestigator,
    Map<String, String> links
) {}
```

Domain object, entity, dan representation adalah tiga hal berbeda.

```text
Database Entity  !=  Domain Model  !=  HTTP Representation
```

Kadang bisa mirip, tetapi jangan diasumsikan sama.

---

## 7. Selected Representation

**Selected representation** adalah representation yang server pilih untuk dikirim berdasarkan request.

Pemilihan bisa dipengaruhi oleh:

- URI,
- method,
- `Accept`,
- `Accept-Language`,
- `Accept-Encoding`,
- authorization,
- API version,
- query parameter,
- feature flag,
- tenant policy,
- server configuration.

Contoh:

```http
GET /cases/CASE-2026-0001
Accept: application/json
Accept-Language: id-ID
Authorization: Bearer eyJ...
```

Server mungkin memilih:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Language: id-ID
Vary: Accept, Accept-Language, Authorization
```

Representation yang dikembalikan bisa berbeda untuk:

- investigator,
- supervisor,
- respondent,
- public user,
- another agency,
- internal audit service.

Ini menimbulkan konsekuensi besar untuk caching dan authorization.

Jika representation berbeda berdasarkan authorization, cache shared tidak boleh sembarangan menyimpan/membagikan response.

---

## 8. Operation Semantics

**Operation semantics** adalah makna dari request terhadap resource.

HTTP request minimal membawa:

```text
method + target URI + headers + optional body
```

Contoh:

```http
PUT /cases/CASE-2026-0001/assignment/current
Content-Type: application/json

{
  "investigatorId": "USR-991"
}
```

Semantics-nya bukan hanya “panggil function assign”. Lebih presisi:

```text
Client meminta server agar current assignment resource untuk case tertentu
menjadi representation yang diberikan.
```

Kalau request yang sama dikirim dua kali, hasil akhirnya tetap assignment ke `USR-991`. Itu cocok dengan `PUT` karena idempotent.

Berbeda dengan:

```http
POST /cases/CASE-2026-0001/assignment-events
Content-Type: application/json

{
  "investigatorId": "USR-991",
  "reason": "Manual reassignment"
}
```

Semantics-nya:

```text
Client meminta server membuat assignment event baru.
```

Kalau dikirim dua kali, bisa menghasilkan dua event. Ini cocok dengan `POST`, kecuali diberi idempotency key.

---

## 9. Safe, Idempotent, Cacheable: Tiga Properti Method yang Wajib Dikuasai

HTTP method punya beberapa properti penting.

Tiga yang paling penting untuk backend correctness:

1. **Safe**
2. **Idempotent**
3. **Cacheable**

---

## 10. Safe Method

Method disebut **safe** jika request tersebut tidak dimaksudkan untuk mengubah state server.

Safe bukan berarti “tidak melakukan apa pun”. Server boleh melakukan aktivitas internal seperti:

- logging,
- metrics,
- access audit,
- cache warming,
- rate limit accounting,
- read counter yang tidak dianggap bagian dari user-requested state change.

Tetapi client tidak meminta state-changing operation.

Contoh safe:

```http
GET /cases/CASE-2026-0001
HEAD /cases/CASE-2026-0001
OPTIONS /cases/CASE-2026-0001
```

Tidak safe:

```http
POST /cases
PUT /cases/CASE-2026-0001
PATCH /cases/CASE-2026-0001
DELETE /cases/CASE-2026-0001
```

### 10.1 Kenapa Safe Penting

Safe method bisa diperlakukan secara khusus oleh:

- browser,
- crawler,
- cache,
- prefetcher,
- monitoring tool,
- link checker,
- gateway,
- retry mechanism.

Jika kamu membuat GET yang mengubah state:

```http
GET /cases/CASE-2026-0001/approve
```

Maka sistem eksternal yang “hanya membuka link” bisa tanpa sengaja menjalankan approval.

Ini bukan teori. Link prefetcher, crawler, scanner, dan monitoring tool bisa memanggil GET. Karena GET secara semantics safe, mereka boleh menganggap request tidak mengubah state.

### 10.2 Safe Method Anti-Pattern

Buruk:

```http
GET /orders/123/cancel
GET /users/991/delete
GET /cases/100/assign?to=USR-1
```

Lebih baik:

```http
POST /orders/123/cancellations
DELETE /users/991
PUT /cases/100/assignment/current
```

### 10.3 “Tapi GET Kami Hanya Update Last Viewed”

Ini area abu-abu.

Misalnya:

```http
GET /documents/123
```

Server mencatat:

```text
lastViewedAt = now()
```

Apakah ini melanggar safe?

Jawaban praktis: tergantung apakah perubahan itu dianggap bagian dari state yang diminta user atau efek internal yang tidak mempengaruhi semantics resource utama.

Kalau `lastViewedAt` dipakai untuk audit formal, notifikasi legal, SLA, atau workflow, maka GET menjadi state-changing secara domain. Jangan lakukan diam-diam.

Lebih baik:

```http
POST /documents/123/view-events
```

Atau kirim read receipt eksplisit:

```http
POST /documents/123/read-receipts
```

Rule of thumb:

```text
Jika side effect punya konsekuensi domain, compliance, audit, billing, notification, atau workflow,
jangan sembunyikan di GET.
```

---

## 11. Idempotent Method

Method disebut **idempotent** jika beberapa request identik memiliki efek akhir yang sama dengan satu request.

Idempotent bukan berarti response selalu sama. Yang sama adalah **intended effect on server state**.

Contoh idempotent:

```http
PUT /cases/CASE-1/assignment/current
Content-Type: application/json

{
  "investigatorId": "USR-9"
}
```

Jika dikirim 1 kali:

```text
current assignment = USR-9
```

Jika dikirim 5 kali:

```text
current assignment = USR-9
```

Efek akhirnya sama.

Contoh non-idempotent:

```http
POST /cases/CASE-1/comments
Content-Type: application/json

{
  "text": "Please review evidence."
}
```

Jika dikirim 1 kali:

```text
1 comment created
```

Jika dikirim 5 kali:

```text
5 comments created
```

Efeknya berbeda.

### 11.1 Kenapa Idempotency Penting

Distributed systems penuh ketidakpastian.

Client bisa mengalami:

- connection reset,
- timeout,
- gateway 504,
- mobile network drop,
- load balancer retry,
- service mesh retry,
- SDK retry,
- duplicate submit,
- user double-click.

Pertanyaan penting:

```text
Jika request pertama sebenarnya berhasil tetapi response gagal sampai ke client,
apakah client aman mengirim request yang sama lagi?
```

Untuk idempotent method, lebih aman. Untuk non-idempotent method, perlu mekanisme tambahan seperti `Idempotency-Key`.

### 11.2 Idempotent Tidak Berarti Tidak Ada Audit Event

Misalnya:

```http
DELETE /cases/CASE-1/watchers/USR-9
```

Request pertama menghapus watcher.

Request kedua menemukan watcher sudah tidak ada.

Efek akhir tetap sama:

```text
USR-9 bukan watcher CASE-1
```

Tetapi server mungkin mencatat dua access log atau dua audit teknis. Itu tidak otomatis merusak idempotency, selama intended resource state tetap sama.

Namun hati-hati: jika audit event adalah domain event yang punya konsekuensi legal, maka duplicate request bisa berarti duplicate event. Dalam sistem compliance, kamu harus membedakan:

- technical access log,
- security audit log,
- domain audit event,
- legal evidence event.

Idempotency harus didefinisikan pada level yang tepat.

---

## 12. Cacheable Method

Method disebut cacheable jika response-nya boleh disimpan untuk digunakan lagi, jika aturan caching mengizinkan.

Secara praktis, caching paling umum berlaku untuk:

```http
GET
HEAD
```

POST secara spesifikasi bisa dibuat cacheable dalam kondisi tertentu, tetapi di dunia nyata jarang dipakai untuk shared caching umum. Untuk backend production, treat POST caching as advanced/special-case.

### 12.1 Kenapa Cacheability Penting untuk Backend

Backend yang tidak mengontrol cache semantics akan mengalami:

- data stale muncul di client,
- data private tersimpan di shared cache,
- CDN meng-cache response yang salah,
- load tinggi karena semua request dynamic,
- conditional requests tidak dimanfaatkan,
- ETag tidak konsisten,
- latency buruk.

Contoh response aman untuk cache publik:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
ETag: "case-type-list-v12"
Content-Type: application/json
```

Untuk reference data:

```http
GET /reference/case-types
```

Contoh response user-specific:

```http
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: application/json
```

Untuk:

```http
GET /me/profile
```

### 12.2 Cacheability Bukan Hanya Performance

Caching adalah correctness contract.

Header cache salah bisa menjadi security incident.

Misalnya:

```http
GET /cases/CASE-SECRET
Authorization: Bearer ...
```

Response:

```http
Cache-Control: public, max-age=600
```

Jika ada shared proxy/CDN, data sensitif bisa bocor.

Backend harus tahu kapan response:

- boleh public cache,
- hanya private cache,
- harus revalidate,
- tidak boleh store,
- boleh stale,
- harus bervariasi berdasarkan header tertentu.

Caching akan dibahas mendalam di Part 013, tetapi fondasinya dimulai dari semantics method dan representation.

---

## 13. Method Matrix dari Perspektif Backend

Tabel praktis:

| Method | Safe | Idempotent | Umum Cacheable | Makna Backend |
|---|---:|---:|---:|---|
| GET | Ya | Ya | Ya | Ambil representation resource |
| HEAD | Ya | Ya | Ya | Ambil metadata seperti GET tanpa body |
| OPTIONS | Ya | Ya | Tidak umum | Tanya capability/communication options |
| TRACE | Ya | Ya | Tidak | Diagnostic loopback; biasanya disabled |
| POST | Tidak | Tidak secara default | Jarang | Proses request, create subordinate resource, command |
| PUT | Tidak | Ya | Tidak | Replace/create resource pada target URI |
| PATCH | Tidak | Tidak secara default | Tidak umum | Apply partial modification |
| DELETE | Tidak | Ya | Tidak | Hapus/deactivate/unlink target resource |
| CONNECT | Tidak | Tidak | Tidak | Tunnel; umumnya proxy use case |

Catatan penting:

1. `PATCH` bisa dibuat idempotent jika patch document dan server semantics dirancang demikian, tetapi tidak otomatis.
2. `POST` bisa dibuat idempotent dengan `Idempotency-Key`, tetapi method-nya sendiri tidak memberi jaminan idempotent.
3. `DELETE` idempotent bukan berarti response harus selalu `200`; request kedua bisa `404` atau `204`, tergantung contract.
4. Safe/idempotent/cacheable adalah semantics yang harus dihormati server, bukan dekorasi dokumentasi.

---

## 14. GET dari Sisi Server

### 14.1 Semantics

`GET` meminta representation dari target resource.

Contoh:

```http
GET /cases/CASE-2026-0001
Accept: application/json
```

Server harus berpikir:

```text
Apa selected representation dari resource /cases/CASE-2026-0001 untuk requester ini,
dengan Accept, Authorization, Language, tenant, dan policy yang berlaku?
```

Bukan:

```text
Panggil getCaseById().
```

### 14.2 GET dan Authorization

`GET` bukan berarti semua boleh baca. Safe tidak sama dengan public.

Kemungkinan hasil:

```http
200 OK       -> resource ada dan caller boleh melihat representation
401 Unauthorized -> caller belum authenticated
403 Forbidden    -> caller authenticated tapi tidak boleh akses
404 Not Found    -> resource tidak ada atau sengaja disembunyikan
410 Gone         -> resource pernah ada tapi sudah tidak tersedia secara permanen
```

Dalam domain sensitif, `404` kadang dipakai untuk menyembunyikan keberadaan resource.

Contoh:

```text
Respondent tidak boleh tahu bahwa case internal sedang diselidiki.
```

Maka untuk respondent:

```http
GET /cases/CASE-SECRET
HTTP/1.1 404 Not Found
```

Walau resource ada.

Tetapi untuk investigator:

```http
HTTP/1.1 200 OK
```

Ini bukan “bohong”; ini authorization-aware representation/resource visibility. Namun harus konsisten dan terdokumentasi secara internal.

### 14.3 GET dan Query Parameter

Query parameter sering dipakai untuk filtering:

```http
GET /cases?status=OPEN&assignedTo=USR-991&page=1&pageSize=50
```

Semantics-nya tetap retrieval. Query parameter bukan tempat untuk command:

Buruk:

```http
GET /cases/CASE-1?approve=true
GET /users/USR-9?delete=true
```

Lebih benar:

```http
POST /cases/CASE-1/transitions
DELETE /users/USR-9
```

### 14.4 GET dan Body

Beberapa stack teknis memungkinkan GET dengan body, tetapi ini buruk untuk interoperabilitas.

Banyak proxy, cache, gateway, library, dan tool tidak punya semantics konsisten untuk GET body. Untuk query kompleks, pertimbangkan:

1. query parameter jika masih reasonable,
2. POST ke search resource jika query besar,
3. persistent saved search resource.

Contoh:

```http
POST /case-searches
Content-Type: application/json

{
  "filters": { ... },
  "sort": [ ... ]
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /case-searches/SRCH-123
```

Lalu:

```http
GET /case-searches/SRCH-123/results
```

Atau pragmatic:

```http
POST /cases/search
```

Jika domain memerlukan query kompleks dan tidak perlu resource search permanen.

---

## 15. POST dari Sisi Server

### 15.1 Semantics

`POST` meminta server memproses representation yang dikirim sesuai semantics target resource.

POST sangat fleksibel. Ia bisa dipakai untuk:

- create subordinate resource,
- submit command,
- start async process,
- append event,
- execute complex search,
- perform non-idempotent operation,
- trigger workflow transition.

Fleksibilitas ini membuat POST sering disalahgunakan.

### 15.2 POST untuk Create Collection Item

```http
POST /cases
Content-Type: application/json

{
  "subjectId": "SUBJ-1",
  "complaintType": "MARKET_ABUSE",
  "description": "..."
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-2026-0001
Content-Type: application/json

{
  "id": "CASE-2026-0001",
  "status": "DRAFT"
}
```

Semantics:

```text
Client meminta collection /cases membuat subordinate resource baru.
Server memilih URI resource baru.
```

### 15.3 POST untuk Command

```http
POST /cases/CASE-2026-0001/transitions
Content-Type: application/json

{
  "type": "SUBMIT",
  "comment": "Initial evidence complete"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-2026-0001/transitions/TRN-1001
```

Semantics:

```text
Client membuat transition record atau meminta transition diproses.
```

Untuk workflow-heavy domain, ini sering lebih baik daripada memaksa semua state change menjadi `PATCH /cases/{id}`.

Mengapa?

Karena transition punya:

- actor,
- timestamp,
- reason,
- validation rules,
- approval chain,
- auditability,
- side effects,
- possible asynchronous processing.

### 15.4 POST dan Idempotency-Key

Jika operasi POST tidak boleh double-execute, tambahkan idempotency mechanism.

Contoh:

```http
POST /payments
Idempotency-Key: 8f7c2f1a-3c8f-4f1c-a9d8-f44a0c7aa912
Content-Type: application/json

{
  "amount": 100000,
  "currency": "IDR",
  "beneficiaryId": "BEN-1"
}
```

Untuk case workflow:

```http
POST /cases/CASE-2026-0001/transitions
Idempotency-Key: client-req-20260618-0001
Content-Type: application/json

{
  "type": "SUBMIT"
}
```

Server harus menyimpan:

- idempotency key,
- request fingerprint,
- actor/tenant,
- operation scope,
- response result,
- expiry/replay window.

Ini akan dibahas detail di Part 011.

### 15.5 POST Anti-Pattern

Buruk:

```http
POST /getCase
POST /listCases
POST /deleteCase
POST /updateCase
```

Kadang tim melakukan ini karena:

- ingin semua endpoint punya body JSON,
- malas memikirkan method semantics,
- gateway hanya allow POST,
- legacy RPC mindset,
- semua response dibungkus sama.

Konsekuensinya:

- cacheability hilang,
- retry ambiguity,
- observability lemah,
- API documentation tidak informatif,
- gateway policy sulit,
- client SDK jadi command soup.

---

## 16. PUT dari Sisi Server

### 16.1 Semantics

`PUT` meminta server membuat atau mengganti state target resource dengan representation yang diberikan.

Contoh:

```http
PUT /cases/CASE-2026-0001/assignment/current
Content-Type: application/json

{
  "investigatorId": "USR-991"
}
```

Semantics:

```text
Set current assignment resource menjadi representation ini.
```

Jika diulang, efek akhirnya sama.

### 16.2 PUT untuk Client-Chosen URI

`PUT` cocok jika client tahu URI resource yang ingin dibuat/diganti.

Contoh:

```http
PUT /cases/CASE-2026-0001/tags/HIGH-RISK
```

Body mungkin kosong atau berisi metadata:

```json
{
  "reason": "Risk score above threshold"
}
```

Efek:

```text
Tag HIGH-RISK ada pada CASE-2026-0001.
```

Request sama berulang tetap menghasilkan state yang sama.

### 16.3 PUT Bukan Partial Update

Kesalahan umum:

```http
PUT /users/USR-1
Content-Type: application/json

{
  "displayName": "Budi"
}
```

Jika PUT berarti replace, maka field lain yang tidak dikirim seharusnya hilang/default. Tetapi banyak API memperlakukan ini sebagai partial update. Ini membuat semantics kabur.

Jika ingin partial update, gunakan:

```http
PATCH /users/USR-1
```

Atau command-specific resource:

```http
POST /users/USR-1/display-name-changes
```

Jika tim tetap memakai PUT partial karena legacy, dokumentasikan jelas. Tetapi untuk desain baru, jangan.

### 16.4 PUT dan Optimistic Concurrency

PUT sering harus dilindungi dengan `If-Match`:

```http
PUT /cases/CASE-2026-0001/assignment/current
If-Match: "v7"
Content-Type: application/json

{
  "investigatorId": "USR-991"
}
```

Jika current version masih `v7`, update berhasil.

Jika sudah berubah:

```http
HTTP/1.1 412 Precondition Failed
```

Ini mencegah lost update.

---

## 17. PATCH dari Sisi Server

### 17.1 Semantics

`PATCH` digunakan untuk menerapkan partial modification pada resource.

Berbeda dengan PUT, body PATCH bukan representation lengkap resource, tetapi **patch document**.

Contoh JSON Merge Patch:

```http
PATCH /cases/CASE-2026-0001
Content-Type: application/merge-patch+json
If-Match: "v7"

{
  "priority": "HIGH",
  "deadline": "2026-07-01"
}
```

Contoh JSON Patch:

```http
PATCH /cases/CASE-2026-0001
Content-Type: application/json-patch+json
If-Match: "v7"

[
  { "op": "replace", "path": "/priority", "value": "HIGH" },
  { "op": "replace", "path": "/deadline", "value": "2026-07-01" }
]
```

### 17.2 PATCH Tidak Otomatis Idempotent

Patch ini idempotent:

```json
{
  "priority": "HIGH"
}
```

Karena mengulangnya tetap priority HIGH.

Patch ini tidak idempotent:

```json
[
  { "op": "add", "path": "/comments/-", "value": "Please review" }
]
```

Jika diulang, comment bisa bertambah dua kali.

### 17.3 PATCH vs POST Command

Pertanyaan praktis:

```text
Untuk update status case, pakai PATCH /cases/{id} atau POST /cases/{id}/transitions?
```

Gunakan `PATCH` jika:

- client mengubah field representation,
- perubahan sederhana,
- tidak ada workflow event kompleks,
- tidak perlu command identity,
- tidak banyak side effect domain.

Gunakan `POST /transitions` jika:

- perubahan adalah state transition domain,
- perlu reason/comment/actor,
- ada rule kompleks,
- ada audit event formal,
- ada approval/escalation,
- side effect penting,
- transition perlu identity.

Contoh:

```http
PATCH /cases/CASE-1

{
  "priority": "HIGH"
}
```

vs

```http
POST /cases/CASE-1/transitions

{
  "type": "ESCALATE",
  "reason": "High systemic risk"
}
```

Keduanya bisa mengubah `status`, tetapi semantics domain-nya berbeda.

---

## 18. DELETE dari Sisi Server

### 18.1 Semantics

`DELETE` meminta server menghapus hubungan target resource dengan current functionality-nya.

Dalam backend nyata, DELETE tidak selalu physical delete.

Bisa berarti:

- hard delete,
- soft delete,
- deactivate,
- cancel,
- revoke,
- unlink,
- archive,
- mark as deleted,
- schedule deletion.

Contoh:

```http
DELETE /cases/CASE-1/watchers/USR-9
```

Semantics:

```text
USR-9 tidak lagi menjadi watcher CASE-1.
```

Idempotent.

### 18.2 DELETE Response

Kemungkinan response:

```http
204 No Content
```

Jika berhasil dan tidak perlu body.

```http
200 OK
Content-Type: application/json

{
  "id": "CASE-1",
  "deleted": true
}
```

Jika ingin mengembalikan representation.

```http
202 Accepted
```

Jika deletion asynchronous.

```http
404 Not Found
```

Jika target tidak ditemukan.

```http
409 Conflict
```

Jika resource tidak boleh dihapus karena state domain.

Contoh:

```text
Case yang sudah CLOSED tidak boleh dihapus karena retention policy.
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/case-retention-policy",
  "title": "Case cannot be deleted",
  "status": 409,
  "detail": "Closed cases must be retained for 7 years."
}
```

### 18.3 DELETE dan Idempotency Response

Jika `DELETE /resource/123` dipanggil dua kali, efek akhirnya sama: resource tidak tersedia.

Tetapi response bisa berbeda:

1. Pertama: `204 No Content`
2. Kedua: `404 Not Found`

Apakah ini melanggar idempotency?

Tidak, karena idempotency berbicara efek server state, bukan response identik.

Namun untuk client ergonomics, beberapa API memilih selalu `204` untuk delete yang targetnya sudah tidak ada, selama caller punya authority terhadap resource scope tersebut.

Trade-off:

| Pilihan | Kelebihan | Risiko |
|---|---|---|
| Second DELETE returns 404 | Lebih informatif | Client retry harus handle 404 sebagai acceptable |
| Second DELETE returns 204 | Lebih retry-friendly | Bisa menyembunyikan typo/resource salah |

Untuk domain sensitif, pilih berdasarkan audit dan security requirement.

---

## 19. HEAD, OPTIONS, TRACE, CONNECT

### 19.1 HEAD

`HEAD` meminta response seperti GET tetapi tanpa body.

Berguna untuk:

- cek existence,
- cek metadata,
- cek ETag,
- cek Content-Length,
- cek Last-Modified,
- download preflight,
- health-ish metadata.

Contoh:

```http
HEAD /files/FILE-991
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 9918272
ETag: "file-v12"
```

Server harus memastikan metadata HEAD konsisten dengan GET.

### 19.2 OPTIONS

`OPTIONS` meminta communication options untuk target resource.

Dalam praktik modern, OPTIONS sering muncul untuk CORS preflight:

```http
OPTIONS /cases/CASE-1
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: content-type, authorization
```

Backend/gateway harus merespons sesuai policy.

OPTIONS bukan endpoint bisnis.

### 19.3 TRACE

`TRACE` adalah diagnostic method. Banyak production server menonaktifkannya karena potensi security concern dan jarang diperlukan untuk API business.

### 19.4 CONNECT

`CONNECT` digunakan untuk membuat tunnel, biasanya oleh proxy untuk HTTPS. Backend application biasa jarang mengimplementasikannya.

---

## 20. URI + Method = Contract

URI sendiri tidak cukup.

Method sendiri juga tidak cukup.

Kontrak ada pada kombinasi:

```text
METHOD + URI + headers + representation semantics
```

Contoh resource sama, method berbeda:

```http
GET /cases/CASE-1
```

Ambil representation case.

```http
PUT /cases/CASE-1
```

Ganti representation case.

```http
PATCH /cases/CASE-1
```

Ubah sebagian representation/state case.

```http
DELETE /cases/CASE-1
```

Hapus/deactivate case.

URI sama, semantics berbeda karena method berbeda.

### 20.1 Jangan Membaca URI Saja

Buruk:

```http
POST /cases/CASE-1/update
POST /cases/CASE-1/delete
POST /cases/CASE-1/get
```

Lebih baik:

```http
GET    /cases/CASE-1
PATCH  /cases/CASE-1
DELETE /cases/CASE-1
```

Tetapi untuk workflow action yang bukan CRUD biasa:

```http
POST /cases/CASE-1/transitions
```

Ini sah karena target resource `transitions` menerima creation of transition event/command.

---

## 21. Server Authority atas Semantics

Client bisa meminta apa pun.

Server yang menentukan:

- apakah method didukung,
- apakah content type didukung,
- apakah caller authorized,
- apakah state transition valid,
- apakah precondition terpenuhi,
- apakah response cacheable,
- representation apa yang dikirim,
- status code apa yang benar.

Contoh:

```http
PATCH /cases/CASE-1
Content-Type: application/json

{
  "status": "CLOSED"
}
```

Server tidak boleh otomatis percaya bahwa client boleh mengubah status menjadi CLOSED.

Server harus mengevaluasi:

1. Apakah resource ada?
2. Apakah caller authenticated?
3. Apakah caller authorized untuk close case?
4. Apakah case berada di state yang bisa ditutup?
5. Apakah required fields lengkap?
6. Apakah ada pending review?
7. Apakah optimistic lock terpenuhi?
8. Apakah transition perlu audit reason?
9. Apakah side effect harus dijalankan?
10. Apa response semantics yang benar?

HTTP request adalah proposal/intensi dari client. Server adalah authority yang memutuskan.

---

## 22. HTTP API sebagai State Machine Boundary

Backend API sering menjadi boundary untuk state machine domain.

Contoh enforcement case:

```text
DRAFT
  -> SUBMITTED
  -> TRIAGED
  -> UNDER_INVESTIGATION
  -> ESCALATED
  -> LEGAL_REVIEW
  -> DECIDED
  -> CLOSED
```

HTTP method/status harus merefleksikan state machine ini.

### 22.1 Valid Transition

Request:

```http
POST /cases/CASE-1/transitions
Content-Type: application/json

{
  "type": "SUBMIT"
}
```

Jika current state `DRAFT` dan semua valid:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1/transitions/TRN-1
```

### 22.2 Invalid Transition

Jika current state `CLOSED`:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "A closed case cannot be submitted."
}
```

Kenapa `409`?

Karena request mungkin syntactically valid, caller mungkin authorized, tetapi bertentangan dengan current state resource.

### 22.3 Missing Required Input

Jika request submit butuh `submissionNote`:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "errors": [
    {
      "field": "submissionNote",
      "reason": "required"
    }
  ]
}
```

### 22.4 Unauthorized Transition

Jika caller bukan investigator:

```http
HTTP/1.1 403 Forbidden
```

### 22.5 Unknown Case

```http
HTTP/1.1 404 Not Found
```

Perhatikan: status code menjadi bagian dari state machine boundary. Bukan hiasan.

---

## 23. Resource Modeling: Entity, Process, Event, Projection

Backend engineer perlu mampu memilih jenis resource.

Tidak semua resource sama.

### 23.1 Entity Resource

Mewakili benda domain yang relatif stabil.

```http
/cases/{caseId}
/investigators/{userId}
/respondents/{respondentId}
```

Cocok untuk:

- GET,
- PUT,
- PATCH,
- DELETE,
- conditional requests.

### 23.2 Collection Resource

Mewakili kumpulan entity.

```http
/cases
/users
/evidence-items
```

Cocok untuk:

- GET list/search sederhana,
- POST create item.

### 23.3 Relationship Resource

Mewakili hubungan.

```http
/cases/{caseId}/watchers/{userId}
/cases/{caseId}/related-cases/{relatedCaseId}
```

Cocok untuk:

- PUT create relationship idempotently,
- DELETE remove relationship idempotently.

### 23.4 Event Resource

Mewakili kejadian domain.

```http
/cases/{caseId}/audit-events/{eventId}
/cases/{caseId}/transitions/{transitionId}
```

Biasanya immutable.

Cocok untuk:

- GET event,
- GET collection,
- POST append event/transition.

### 23.5 Process / Job Resource

Mewakili pekerjaan asynchronous.

```http
/exports/{exportId}
/bulk-imports/{importId}
/report-generation-jobs/{jobId}
```

Cocok untuk:

- POST start job,
- GET status,
- DELETE cancel if supported.

Contoh:

```http
POST /case-exports
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /case-exports/EXP-123
Retry-After: 10
```

Lalu:

```http
GET /case-exports/EXP-123
```

### 23.6 Projection Resource

Mewakili read model/report/summary.

```http
/case-dashboard/summary
/reports/enforcement-risk
/cases/{caseId}/timeline
```

Biasanya read-heavy dan cacheable dengan hati-hati.

### 23.7 Capability Resource

Mewakili action yang tersedia.

```http
GET /cases/{caseId}/available-transitions
```

Response:

```json
{
  "caseId": "CASE-1",
  "availableTransitions": [
    {
      "type": "ESCALATE",
      "requiresReason": true
    },
    {
      "type": "REQUEST_EVIDENCE",
      "requiresRespondent": true
    }
  ]
}
```

Berguna untuk workflow UI dan client orchestration.

---

## 24. Case Study 1: Submit Complaint

### 24.1 Problem

User membuat complaint baru yang akan menjadi case.

### 24.2 Candidate Designs

#### Buruk

```http
POST /submitComplaint
```

Response:

```http
HTTP/1.1 200 OK

{
  "success": true,
  "caseId": "CASE-1"
}
```

Masalah:

- URI command-style,
- status code kurang presisi,
- tidak ada Location,
- tidak jelas resource yang dibuat,
- retry bisa membuat duplicate case.

#### Lebih Baik

```http
POST /complaints
Idempotency-Key: 2a91c1c6-38d6-4e52-b4d2-9de6d1f7f601
Content-Type: application/json

{
  "subjectId": "SUBJ-1",
  "complaintType": "MARKET_ABUSE",
  "description": "Suspicious trading pattern observed."
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /complaints/CMP-1001
Content-Type: application/json

{
  "id": "CMP-1001",
  "status": "SUBMITTED",
  "createdCaseId": "CASE-2026-0001",
  "links": {
    "self": "/complaints/CMP-1001",
    "case": "/cases/CASE-2026-0001"
  }
}
```

### 24.3 Reasoning

- `POST /complaints` karena client meminta collection membuat resource baru.
- `201 Created` karena complaint resource dibuat.
- `Location` memberi URI canonical.
- `Idempotency-Key` mencegah duplicate submission saat retry.
- Jika processing async, bisa `202 Accepted` dan job/status resource.

---

## 25. Case Study 2: Assign Investigator

### 25.1 Problem

Supervisor meng-assign investigator ke case.

### 25.2 Option A: Current Assignment as Singleton Sub-Resource

```http
PUT /cases/CASE-1/assignment/current
If-Match: "case-v7"
Content-Type: application/json

{
  "investigatorId": "USR-991",
  "reason": "Expertise in market abuse cases"
}
```

Response:

```http
HTTP/1.1 200 OK
ETag: "case-v8"
Content-Type: application/json

{
  "caseId": "CASE-1",
  "investigatorId": "USR-991",
  "assignedAt": "2026-06-18T10:00:00Z",
  "reason": "Expertise in market abuse cases"
}
```

Cocok jika:

- current assignment hanya satu,
- operasi set assignment idempotent,
- duplicate request tidak boleh membuat event tambahan bermakna,
- client tahu target resource.

### 25.3 Option B: Assignment Event

```http
POST /cases/CASE-1/assignment-events
Idempotency-Key: assign-case-1-usr-991-20260618
Content-Type: application/json

{
  "investigatorId": "USR-991",
  "reason": "Expertise in market abuse cases"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1/assignment-events/AE-123
```

Cocok jika:

- setiap assignment adalah formal event,
- assignment history penting,
- side effect banyak,
- perlu audit event identity,
- approval/review pipeline terlibat.

### 25.4 Kesimpulan

Tidak ada satu jawaban universal.

Pertanyaan desain yang benar:

```text
Apakah operasi ini lebih tepat sebagai replacement state resource,
atau sebagai creation of domain event/command resource?
```

---

## 26. Case Study 3: Approve Decision

### 26.1 Problem

Legal reviewer menyetujui draft decision.

### 26.2 Buruk

```http
GET /cases/CASE-1/approveDecision
```

Fatal karena GET mengubah state.

### 26.3 Mungkin, tapi Kurang Kaya

```http
PATCH /cases/CASE-1
Content-Type: application/json

{
  "decisionStatus": "APPROVED"
}
```

Ini tampak sederhana, tetapi bisa terlalu lemah jika approval adalah domain action dengan rules formal.

### 26.4 Lebih Tepat untuk Workflow

```http
POST /cases/CASE-1/decision-approvals
Idempotency-Key: approve-decision-CASE-1-v12-reviewer-7
Content-Type: application/json

{
  "decisionVersion": 12,
  "comment": "Approved after legal review."
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1/decision-approvals/APP-998
```

### 26.5 Reasoning

Approval bukan sekadar mengubah field. Approval memiliki:

- actor,
- authority,
- timestamp,
- version target,
- comment,
- audit consequence,
- possible notification,
- legal defensibility.

Jadi modelkan sebagai resource event/approval.

---

## 27. Case Study 4: Cancel Order or Cancel Case Process

### 27.1 DELETE vs POST Cancellation

Pertanyaan:

```text
Untuk cancel, pakai DELETE /orders/{id} atau POST /orders/{id}/cancellations?
```

Gunakan `DELETE` jika semantics-nya:

```text
Resource tidak lagi tersedia/aktif.
```

Contoh:

```http
DELETE /draft-cases/CASE-DRAFT-1
```

Gunakan `POST /cancellations` jika cancellation adalah domain event dengan alasan, actor, policy, dan history.

```http
POST /cases/CASE-1/cancellations
Content-Type: application/json

{
  "reason": "Duplicate complaint",
  "replacementCaseId": "CASE-2"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1/cancellations/CAN-1
```

Dalam regulatory systems, cancellation hampir selalu butuh audit. Jadi `POST /cancellations` sering lebih defensible.

---

## 28. Status Code sebagai Semantics, Bukan Decoration

Part khusus status code ada di Part 004. Di sini kita cukup hubungkan status dengan semantics.

Contoh create:

```http
POST /cases
```

Jika created:

```http
201 Created
Location: /cases/CASE-1
```

Jika accepted async:

```http
202 Accepted
Location: /case-creation-jobs/JOB-1
```

Jika validation gagal:

```http
422 Unprocessable Content
```

Jika duplicate natural key:

```http
409 Conflict
```

Jika content type salah:

```http
415 Unsupported Media Type
```

Jika not authorized:

```http
403 Forbidden
```

Jika server dependency down:

```http
503 Service Unavailable
```

Status code memberi informasi ke:

- client,
- SDK,
- retry mechanism,
- gateway,
- monitoring,
- alerting,
- SLO calculation,
- audit tooling.

Kalau semua `200 OK`, kamu memaksa semua pihak parse body custom untuk tahu apa yang terjadi.

---

## 29. Headers sebagai Semantics Amplifier

HTTP semantics tidak hanya method dan status. Header memperkaya kontrak.

Contoh:

```http
POST /cases
Content-Type: application/json
Accept: application/json
Idempotency-Key: 6a1c...
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1
Content-Type: application/json
ETag: "case-v1"
Cache-Control: no-store
Traceparent: 00-...
```

Makna:

- `Content-Type`: body request adalah JSON.
- `Accept`: client ingin JSON.
- `Idempotency-Key`: operasi create harus deduplicated.
- `Location`: URI resource baru.
- `ETag`: validator representation/resource version.
- `Cache-Control`: jangan simpan data sensitif.
- `Traceparent`: observability chain.

Backend engineer top-tier tidak melihat header sebagai detail tambahan. Header adalah control plane.

---

## 30. HTTP Semantics dan Retry

Retry adalah tempat semantics diuji.

### 30.1 GET Retry

```http
GET /cases/CASE-1
```

Jika timeout, retry biasanya aman karena GET safe dan idempotent.

### 30.2 PUT Retry

```http
PUT /cases/CASE-1/assignment/current

{
  "investigatorId": "USR-991"
}
```

Retry biasanya aman karena efek akhirnya sama.

### 30.3 POST Retry Tanpa Idempotency-Key

```http
POST /cases

{
  "subjectId": "SUBJ-1"
}
```

Jika response timeout, client tidak tahu:

- case belum dibuat,
- case sudah dibuat tapi response hilang,
- case dibuat sebagian,
- downstream side effect sudah terjadi.

Retry bisa membuat duplicate.

### 30.4 POST Retry dengan Idempotency-Key

```http
POST /cases
Idempotency-Key: abc-123
```

Server bisa mengembalikan response yang sama untuk duplicate request.

Ini bukan fitur HTTP method bawaan, tetapi application-level reliability pattern di atas HTTP.

---

## 31. HTTP Semantics dan Observability

Observability backend sangat bergantung pada semantics yang benar.

Bayangkan dashboard:

```text
GET /cases/{id}          99.9% success, p95 40ms
POST /cases              99.2% success, p95 180ms
POST /cases/{id}/transitions 98.8% success, p95 250ms
PATCH /cases/{id}        99.0% success, p95 120ms
```

Ini jauh lebih informatif daripada:

```text
POST /api                99.0% success
POST /execute            99.0% success
```

Method dan URI yang meaningful membantu:

- alert routing,
- incident triage,
- SLO definition,
- capacity planning,
- audit investigation,
- security anomaly detection.

Contoh security anomaly:

```text
DELETE /cases/* spike from single API key
```

Mudah dideteksi jika DELETE digunakan benar.

Jika semua command memakai POST `/action`, sinyal hilang.

---

## 32. HTTP Semantics dan Authorization

Resource-oriented design membuat authorization lebih jelas.

Contoh:

```http
GET /cases/CASE-1/evidence/EV-1
```

Pertanyaan authorization:

```text
Can actor read evidence EV-1 under case CASE-1?
```

```http
POST /cases/CASE-1/evidence
```

Pertanyaan:

```text
Can actor add evidence to case CASE-1?
```

```http
DELETE /cases/CASE-1/evidence/EV-1
```

Pertanyaan:

```text
Can actor remove evidence EV-1 from case CASE-1?
```

Dengan command soup:

```http
POST /doEvidenceAction
```

Authorization harus membaca body untuk tahu action. Ini mungkin perlu, tetapi lebih sulit dibuat konsisten di gateway/policy layer.

---

## 33. HTTP Semantics dan Auditability

Dalam sistem regulasi, auditability bukan tambahan. Ia core requirement.

Semantics HTTP membantu audit menjawab:

1. Siapa mengakses resource apa?
2. Dengan method apa?
3. Pada state resource apa?
4. Dengan precondition apa?
5. Response-nya apa?
6. Apakah operasi idempotent atau duplicate?
7. Apakah request mengubah state?
8. Apakah request ditolak karena authorization, validation, atau conflict?

Contoh audit event teknis:

```json
{
  "timestamp": "2026-06-18T10:00:00Z",
  "actor": "USR-991",
  "method": "POST",
  "path": "/cases/CASE-1/transitions",
  "status": 201,
  "transitionId": "TRN-1",
  "idempotencyKey": "submit-case-1-v3",
  "correlationId": "corr-abc"
}
```

Ini jauh lebih defensible daripada:

```json
{
  "path": "/api/action",
  "status": 200,
  "message": "ok"
}
```

---

## 34. HTTP Semantics dan API Evolution

Resource semantics yang baik membuat API lebih mudah berevolusi.

Misalnya awalnya:

```http
GET /cases/CASE-1
```

Response:

```json
{
  "id": "CASE-1",
  "status": "UNDER_REVIEW"
}
```

Kemudian tambah field:

```json
{
  "id": "CASE-1",
  "status": "UNDER_REVIEW",
  "riskLevel": "HIGH",
  "links": {
    "timeline": "/cases/CASE-1/timeline"
  }
}
```

Ini additive dan biasanya backward-compatible.

Jika dari awal API adalah:

```http
POST /getCaseFullDetailForReviewPage
```

Maka endpoint sering terikat pada UI screen tertentu. Evolusinya menjadi kacau ketika ada mobile app, integration partner, audit portal, dan internal dashboard.

Resource-oriented semantics membantu memisahkan:

- domain resource,
- representation variant,
- client use case,
- workflow command.

---

## 35. Designing Semantics: Step-by-Step Method

Saat mendesain endpoint backend, gunakan urutan ini.

### Step 1 — Apa Target Resource-nya?

Tanyakan:

```text
Apa sesuatu yang sedang diakses/diubah/dibuat?
```

Contoh:

- case,
- complaint,
- assignment,
- transition,
- evidence item,
- export job,
- decision approval,
- watcher relationship.

Jika kamu tidak bisa menyebut resource-nya, mungkin kamu sedang mendesain RPC command.

RPC command tidak selalu salah, tetapi harus disadari.

### Step 2 — Apa Intensi Client?

Tanyakan:

```text
Client ingin mengambil representation, membuat subordinate resource,
mengganti resource, mengubah sebagian, menghapus, atau memulai process?
```

Mapping awal:

| Intensi | Candidate Method |
|---|---|
| Retrieve representation | GET |
| Retrieve metadata only | HEAD |
| Create subordinate resource | POST |
| Replace known target resource | PUT |
| Partial modification | PATCH |
| Remove target resource | DELETE |
| Start async/process command | POST |
| Append event | POST |
| Set relationship exists | PUT |
| Remove relationship | DELETE |

### Step 3 — Apakah Operasi Safe?

Jika tidak mengubah state domain:

```text
GET/HEAD/OPTIONS mungkin cocok.
```

Jika mengubah state domain, jangan GET.

### Step 4 — Apakah Operasi Idempotent?

Jika efek akhir request berulang sama:

```text
PUT/DELETE/PATCH designed-idempotent bisa cocok.
```

Jika tidak:

```text
POST + Idempotency-Key jika retry safety diperlukan.
```

### Step 5 — Apakah Resource URI Dipilih Client atau Server?

Jika server memilih ID:

```http
POST /cases
```

Jika client tahu URI final:

```http
PUT /cases/CASE-CLIENT-GENERATED-1
```

### Step 6 — Apakah Ada Workflow/Event yang Perlu Diaudit?

Jika ya, pertimbangkan resource event:

```http
POST /cases/{id}/transitions
POST /cases/{id}/approvals
POST /cases/{id}/cancellations
```

Daripada hanya:

```http
PATCH /cases/{id}
```

### Step 7 — Apa Response Semantics?

Tentukan:

- `200 OK` untuk success with representation,
- `201 Created` untuk created resource,
- `202 Accepted` untuk async accepted,
- `204 No Content` untuk success tanpa body,
- `400/422` untuk request invalid,
- `401/403` untuk auth/authz,
- `404/410` untuk resource absence,
- `409` untuk state conflict,
- `412` untuk failed precondition,
- `415` untuk content type salah,
- `429` untuk rate limit,
- `503` untuk temporary unavailability.

### Step 8 — Header Apa yang Menjadi Bagian Kontrak?

Pikirkan:

- `Content-Type`,
- `Accept`,
- `Location`,
- `ETag`,
- `Cache-Control`,
- `Idempotency-Key`,
- `Retry-After`,
- `Vary`,
- `WWW-Authenticate`,
- tracing/correlation headers.

### Step 9 — Apa Failure Mode-nya?

Untuk setiap endpoint, jawab:

1. Apa yang terjadi jika request duplicate?
2. Apa yang terjadi jika response timeout setelah commit?
3. Apa yang terjadi jika caller unauthorized?
4. Apa yang terjadi jika state sudah berubah?
5. Apa yang terjadi jika downstream gagal?
6. Apa yang terjadi jika body invalid?
7. Apa yang terjadi jika content type salah?
8. Apa yang terjadi jika request terlalu besar?
9. Apa yang terjadi jika client disconnect?
10. Apa yang dicatat di audit/log/trace?

Semantics yang baik harus tahan terhadap failure mode ini.

---

## 36. Java/Spring Mapping Awal

Kita belum masuk implementasi penuh, tetapi berikut mapping awal.

### 36.1 GET

```java
@GetMapping(
    value = "/cases/{caseId}",
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<CaseResponse> getCase(@PathVariable String caseId) {
    CaseResponse response = caseQueryService.getCase(caseId);
    return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(response);
}
```

### 36.2 POST Create

```java
@PostMapping(
    value = "/cases",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<CaseResponse> createCase(
        @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
        @Valid @RequestBody CreateCaseRequest request
) {
    CaseResponse created = caseCommandService.createCase(request, idempotencyKey);

    URI location = URI.create("/cases/" + created.id());

    return ResponseEntity.created(location)
            .cacheControl(CacheControl.noStore())
            .body(created);
}
```

### 36.3 PUT Idempotent Set Relationship/State

```java
@PutMapping(
    value = "/cases/{caseId}/assignment/current",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<AssignmentResponse> setCurrentAssignment(
        @PathVariable String caseId,
        @RequestHeader("If-Match") String ifMatch,
        @Valid @RequestBody SetAssignmentRequest request
) {
    AssignmentResponse response = caseCommandService.setAssignment(caseId, request, ifMatch);

    return ResponseEntity.ok()
            .eTag(response.caseVersionEtag())
            .body(response);
}
```

### 36.4 POST Workflow Transition

```java
@PostMapping(
    value = "/cases/{caseId}/transitions",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<TransitionResponse> transitionCase(
        @PathVariable String caseId,
        @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
        @Valid @RequestBody TransitionRequest request
) {
    TransitionResponse transition = caseWorkflowService.transition(caseId, request, idempotencyKey);

    URI location = URI.create("/cases/" + caseId + "/transitions/" + transition.id());

    return ResponseEntity.created(location)
            .body(transition);
}
```

### 36.5 DELETE

```java
@DeleteMapping("/cases/{caseId}/watchers/{userId}")
public ResponseEntity<Void> removeWatcher(
        @PathVariable String caseId,
        @PathVariable String userId
) {
    watcherService.removeWatcher(caseId, userId);
    return ResponseEntity.noContent().build();
}
```

Kode di atas bukan template final. Yang penting adalah mapping semantics:

- create collection item -> POST + 201 + Location,
- set current assignment -> PUT + idempotent + If-Match,
- workflow transition -> POST event resource,
- remove relationship -> DELETE + 204.

---

## 37. Common Backend Anti-Patterns

### 37.1 Semua Pakai POST

```http
POST /api/get
POST /api/create
POST /api/update
POST /api/delete
```

Masalah:

- method semantics hilang,
- cache/retry/gateway policy lemah,
- observability buruk,
- API tidak self-descriptive.

### 37.2 Semua Error Pakai 200

```http
HTTP/1.1 200 OK

{
  "success": false,
  "error": "Unauthorized"
}
```

Masalah:

- monitoring mengira sukses,
- gateway tidak tahu auth failure,
- client generic tidak bisa handle,
- SLO error rate salah.

### 37.3 GET Mengubah State

```http
GET /users/123/activate
```

Masalah:

- crawler/prefetcher bisa menjalankan side effect,
- violates safe semantics,
- security risk.

### 37.4 PUT untuk Partial Update Tanpa Dokumentasi

```http
PUT /users/123

{
  "name": "New Name"
}
```

Masalah:

- replace vs patch ambiguity,
- client tidak tahu field omitted akan dihapus atau dipertahankan,
- future compatibility buruk.

### 37.5 Status Code Tidak Mewakili Domain Conflict

Buruk:

```http
HTTP/1.1 500 Internal Server Error
```

Untuk case:

```text
Cannot approve because required evidence is missing.
```

Lebih baik:

```http
409 Conflict
```

Atau `422` jika masalahnya input semantic, tergantung model.

### 37.6 Resource Model Mengikuti Database Mentah

```http
GET /case_table/1
GET /case_assignment_table?case_id=1
```

Masalah:

- persistence leak,
- refactoring sulit,
- domain contract lemah.

### 37.7 Action Resource Tanpa Identity/Audit

```http
POST /cases/CASE-1/approve
```

Kadang acceptable untuk simple system. Tetapi untuk domain audit-heavy, lebih baik:

```http
POST /cases/CASE-1/approvals
```

Karena approval bisa menjadi resource:

```http
GET /cases/CASE-1/approvals/APP-1
```

---

## 38. Decision Framework: CRUD vs Workflow vs Event

Gunakan tabel ini.

| Situasi | Model yang Cocok | Contoh |
|---|---|---|
| Ambil data | Resource retrieval | `GET /cases/{id}` |
| Buat entity baru, server pilih ID | Collection create | `POST /cases` |
| Client tahu ID dan ingin set state penuh | PUT resource | `PUT /settings/{key}` |
| Update beberapa field | PATCH resource | `PATCH /cases/{id}` |
| Hapus/unlink resource | DELETE resource | `DELETE /cases/{id}/watchers/{userId}` |
| Tambah event history | Event collection | `POST /cases/{id}/events` |
| Jalankan state transition formal | Transition collection | `POST /cases/{id}/transitions` |
| Approval formal | Approval collection | `POST /cases/{id}/approvals` |
| Start long-running job | Job collection | `POST /exports` |
| Cek job status | Job resource | `GET /exports/{id}` |
| Set relationship idempotently | Relationship resource | `PUT /cases/{id}/watchers/{userId}` |
| Remove relationship | Relationship resource | `DELETE /cases/{id}/watchers/{userId}` |

---

## 39. Backend Semantics Checklist

Sebelum merge endpoint baru, jawab checklist ini.

### 39.1 Resource

- [ ] Apa resource targetnya?
- [ ] Apakah URI merepresentasikan noun/resource, bukan function name?
- [ ] Apakah resource ini entity, collection, relationship, event, job, atau projection?
- [ ] Apakah resource model bocor dari database internal?

### 39.2 Method

- [ ] Apakah method sesuai intensi?
- [ ] Apakah GET benar-benar safe?
- [ ] Apakah PUT benar-benar replace/set target resource?
- [ ] Apakah PATCH benar-benar partial modification?
- [ ] Apakah POST digunakan untuk create/process/command yang memang cocok?
- [ ] Apakah DELETE semantics jelas: hard delete, soft delete, cancel, revoke, unlink?

### 39.3 Idempotency

- [ ] Apakah operasi aman jika retry?
- [ ] Jika POST non-idempotent, apakah perlu `Idempotency-Key`?
- [ ] Apa yang terjadi jika duplicate request datang concurrently?
- [ ] Apa yang terjadi jika response timeout setelah commit?

### 39.4 Representation

- [ ] Apakah response DTO berbeda dari entity internal?
- [ ] Apakah field sensitif disembunyikan?
- [ ] Apakah representation berbeda berdasarkan role/tenant?
- [ ] Jika berbeda, apakah caching dan `Vary` dipikirkan?

### 39.5 Status and Headers

- [ ] Apakah create mengembalikan `201` dan `Location`?
- [ ] Apakah async operation mengembalikan `202` dan status resource?
- [ ] Apakah validation error bukan `500`?
- [ ] Apakah domain conflict menggunakan `409` atau status lain yang tepat?
- [ ] Apakah unsupported media type menjadi `415`?
- [ ] Apakah precondition failure menjadi `412`?
- [ ] Apakah cache headers aman?

### 39.6 Security and Audit

- [ ] Apakah resource-level authorization jelas?
- [ ] Apakah action punya audit trail?
- [ ] Apakah GET tidak menimbulkan domain side effect?
- [ ] Apakah error tidak membocorkan data sensitif?
- [ ] Apakah method/URI/status cukup informatif untuk audit?

### 39.7 Operations

- [ ] Apakah endpoint mudah dimonitor?
- [ ] Apakah cardinality path dinormalisasi di metrics?
- [ ] Apakah timeout dan retry policy sesuai method semantics?
- [ ] Apakah gateway/proxy bisa menerapkan policy berdasarkan method/path?

---

## 40. Latihan Desain

Coba desain endpoint untuk scenario berikut.

### Latihan 1 — Evidence Upload Metadata

User ingin menambahkan metadata evidence baru ke case. File upload-nya akan dilakukan terpisah ke object storage.

Pertanyaan:

1. Resource apa yang dibuat?
2. Method apa?
3. Status response apa?
4. Header apa yang penting?
5. Bagaimana retry safety?

Candidate:

```http
POST /cases/{caseId}/evidence-items
Idempotency-Key: ...
Content-Type: application/json

{
  "fileName": "trade-log.csv",
  "contentType": "text/csv",
  "description": "Trading log from exchange."
}
```

Response:

```http
201 Created
Location: /cases/{caseId}/evidence-items/{evidenceId}
```

### Latihan 2 — Mark Evidence as Verified

Evidence diverifikasi oleh investigator.

Apakah ini:

```http
PATCH /cases/{caseId}/evidence-items/{evidenceId}
```

atau:

```http
POST /cases/{caseId}/evidence-items/{evidenceId}/verifications
```

Jawaban tergantung domain.

Jika verification hanya field sederhana:

```http
PATCH /cases/{caseId}/evidence-items/{evidenceId}

{
  "verified": true
}
```

Jika verification punya actor, timestamp, method, comment, audit formal:

```http
POST /cases/{caseId}/evidence-items/{evidenceId}/verifications

{
  "method": "MANUAL_REVIEW",
  "comment": "Hash and metadata verified."
}
```

Untuk regulatory system, yang kedua biasanya lebih defensible.

### Latihan 3 — Replace Case Classification

Supervisor ingin menetapkan classification case menjadi `HIGH_RISK`.

Candidate:

```http
PUT /cases/{caseId}/classification
Content-Type: application/json
If-Match: "case-v7"

{
  "classification": "HIGH_RISK",
  "reason": "Risk score exceeds threshold"
}
```

Kenapa PUT?

Karena target singleton resource `/classification` diset menjadi representation tertentu. Mengirim request sama berulang menghasilkan state akhir sama.

### Latihan 4 — Add Comment

User menambahkan comment.

Candidate:

```http
POST /cases/{caseId}/comments
Content-Type: application/json
Idempotency-Key: ...

{
  "text": "Please request additional evidence."
}
```

Kenapa POST?

Karena membuat comment baru di collection. Tanpa idempotency key, retry bisa membuat duplicate comment.

---

## 41. Mental Model Ringkas

Pegang model ini:

```text
HTTP request bukan function call.
HTTP request adalah pernyataan intensi terhadap resource.

Method menjelaskan jenis intensi.
URI mengidentifikasi target.
Headers memberi metadata/control.
Body membawa representation atau instruction document.
Status code menjelaskan hasil pada level protocol semantics.
Response body membawa selected representation atau problem details.
```

Jika kamu sudah berpikir seperti ini, desain backend API berubah dari:

```text
Controller method collection
```

menjadi:

```text
Externally observable contract over domain state machine
```

Itulah level yang dibutuhkan untuk backend production.

---

## 42. Kesalahan Berpikir yang Perlu Ditinggalkan

### 42.1 “Yang Penting Client dan Server Sepakat”

Benar hanya untuk sistem kecil dan tertutup.

Di production, ada banyak pihak selain client/server:

- proxy,
- gateway,
- WAF,
- cache,
- observability pipeline,
- retry mechanism,
- SDK generator,
- documentation tool,
- security scanner,
- compliance auditor,
- future clients.

HTTP semantics adalah bahasa bersama untuk semua pihak itu.

### 42.2 “REST Itu Cuma CRUD”

Salah.

Resource-oriented HTTP tidak berarti semua domain dipaksa CRUD. Workflow, event, process, transition, relationship, dan projection juga bisa dimodelkan sebagai resource.

### 42.3 “POST Paling Aman Karena Fleksibel”

POST memang fleksibel, tetapi fleksibilitas berlebihan menghilangkan sinyal.

Gunakan POST saat memang:

- create subordinate resource,
- process command,
- append event,
- start job,
- execute non-idempotent operation.

Jangan gunakan POST karena malas memilih method.

### 42.4 “Idempotent Berarti Response Sama”

Salah.

Idempotency berbicara efek akhir pada server state, bukan byte response identik.

### 42.5 “GET Tidak Boleh Punya Side Effect Sama Sekali”

Lebih presisi:

GET tidak boleh digunakan untuk side effect yang diminta client sebagai domain state change.

Logging dan metrics biasanya okay. Domain event formal biasanya tidak.

---

## 43. Rangkuman

Di part ini kita membangun fondasi semantics dari sisi server:

1. HTTP adalah semantic protocol, bukan sekadar transport JSON.
2. Resource adalah target konseptual yang diidentifikasi URI.
3. Resource tidak harus sama dengan database table.
4. Representation adalah bentuk data yang dikirim untuk mewakili resource state.
5. Selected representation dipilih berdasarkan request dan policy.
6. Method membawa makna:
   - GET retrieve,
   - POST process/create subordinate resource,
   - PUT replace/set target resource,
   - PATCH partial modification,
   - DELETE remove/unlink/deactivate target resource.
7. Safe/idempotent/cacheable memengaruhi retry, cache, gateway, security, dan observability.
8. Workflow-heavy domain sering lebih cocok memakai event/transition resource daripada memaksa PATCH field.
9. Status code dan header adalah bagian dari semantics contract.
10. Desain endpoint yang baik harus mempertimbangkan failure mode, authorization, audit, dan evolusi.

---

## 44. Preview Part Berikutnya

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-002.md
```

Judul:

```text
Request Lifecycle: From Socket to Controller
```

Kita akan membedah perjalanan request dari:

```text
client -> TCP/TLS -> reverse proxy -> load balancer -> servlet container / Netty -> filter chain -> dispatcher -> controller -> service
```

Fokusnya bukan hanya alur happy path, tetapi juga:

- parsing failure,
- malformed request,
- body too large,
- timeout,
- thread pool exhaustion,
- event loop blocking,
- client disconnect,
- gateway-generated error,
- backpressure,
- request cancellation.

---

## 45. Referensi

1. RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
2. RFC 9111 — HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
3. RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
4. RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html
5. RFC 9114 — HTTP/3: https://www.rfc-editor.org/rfc/rfc9114.html
6. RFC 5789 — PATCH Method for HTTP: https://www.rfc-editor.org/rfc/rfc5789.html
7. MDN Web Docs — HTTP request methods: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods
8. OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
9. Spring Framework Reference — Web MVC: https://docs.spring.io/spring-framework/reference/web/webmvc.html
10. Spring Framework Reference — WebFlux: https://docs.spring.io/spring-framework/reference/web/webflux.html

---

## 46. Status Seri

Part ini adalah:

```text
Part 001 dari 032
```

Seri belum selesai.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-000.md">⬅️ HTTP for Web Backend Perspective — Part 000</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-002.md">Part 002 — Request Lifecycle: From Socket to Controller ➡️</a>
</div>
