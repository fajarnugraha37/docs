# learn-http-for-web-backend-perspective-part-024.md

# Part 024 — API Design Styles over HTTP

> Series: **HTTP for Web / Backend Perspective**  
> Audience: **Java Software Engineer / Tech Lead**  
> Focus: **Choosing and governing API styles over HTTP: resource-oriented, RPC-over-HTTP, GraphQL, gRPC, hypermedia, and hybrids**

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membangun fondasi backend HTTP dari beberapa sisi:

1. HTTP semantics.
2. Method correctness.
3. Status code sebagai state contract.
4. Header sebagai control plane.
5. Body/framing.
6. URI/resource modeling.
7. Content negotiation.
8. Validation, error, idempotency, concurrency, caching.
9. Authn/authz, cookies, CORS, rate limiting.
10. Timeout, large payload, streaming, protocol versions, reverse proxy/gateway.

Part ini menjawab pertanyaan yang sering muncul setelah fondasi itu:

> “API saya sebaiknya REST, RPC, GraphQL, gRPC, hypermedia, atau campuran?”

Jawaban yang matang bukan “REST selalu terbaik”, “GraphQL modern”, atau “gRPC paling cepat”. Jawaban yang matang adalah:

> Pilih style API berdasarkan domain shape, consumer shape, failure model, operability, governance, evolvability, security, caching, dan team capability.

HTTP bukan hanya pipa untuk JSON. HTTP menyediakan semantics, method, status, header, caching, conditional request, negotiation, authentication boundary, observability surface, dan interop. API style menentukan seberapa banyak semantics HTTP itu dipakai, diabaikan, atau diganti oleh semantics aplikasi sendiri.

---

## 1. Learning Objectives

Setelah bagian ini, kamu harus bisa:

1. Membedakan HTTP API, REST API, resource-oriented API, RPC-over-HTTP, GraphQL, gRPC, dan hypermedia API.
2. Menjelaskan trade-off setiap style dari sisi backend production.
3. Menentukan style API berdasarkan use case, bukan tren.
4. Mendesain API workflow-heavy tanpa memaksakan CRUD palsu.
5. Menghindari “REST cosplay”: API yang terlihat REST tetapi semantics-nya RPC berantakan.
6. Menghindari “RPC tunnel”: semua operasi POST `/doSomething` tanpa status/method/header contract yang jelas.
7. Memahami kapan GraphQL cocok dan kapan berbahaya.
8. Memahami kapan gRPC cocok dan kapan HTTP/JSON tetap lebih tepat.
9. Mendesain hybrid API secara sadar.
10. Membuat governance rule untuk organisasi.

---

## 2. First Principle: API Style Adalah Pilihan Kontrak

API style bukan hanya pilihan URL shape atau framework.

API style menentukan:

1. Bagaimana client mengekspresikan intent.
2. Bagaimana server mengekspos domain capability.
3. Bagaimana operation di-retry.
4. Bagaimana authorization dilakukan.
5. Bagaimana caching bekerja.
6. Bagaimana observability dibaca.
7. Bagaimana compatibility dijaga.
8. Bagaimana error dikembalikan.
9. Bagaimana tooling bekerja.
10. Bagaimana tim berpikir tentang domain.

Contoh:

```http
POST /cases/123/approve
```

Ini action-oriented. Bukan otomatis buruk.

```http
PATCH /cases/123
Content-Type: application/json

{ "status": "APPROVED" }
```

Ini state-oriented. Bisa baik, bisa buruk.

Perbedaannya bukan kosmetik. Perbedaannya adalah:

- siapa yang menentukan transisi valid?
- apakah approve punya precondition?
- apakah audit event eksplisit?
- apakah command punya idempotency key?
- apakah status update boleh dilakukan oleh semua role?
- apakah approval menghasilkan side effect downstream?
- apakah conflict disampaikan sebagai `409`, `412`, atau domain error?

API style harus membuat invariant domain lebih jelas, bukan menyembunyikannya.

---

## 3. Taxonomy API Style di Atas HTTP

Dalam praktik backend modern, kita sering melihat beberapa style ini:

1. **Resource-oriented HTTP API**
   - API diekspresikan sebagai resource dan representation.
   - Menggunakan method/status/header HTTP secara cukup disiplin.

2. **REST API secara ketat**
   - Resource-oriented.
   - Stateless.
   - Uniform interface.
   - Cacheable bila memungkinkan.
   - Layered system.
   - Optional: hypermedia as engine of application state.

3. **REST-ish JSON API**
   - Resource-oriented sebagian.
   - JSON over HTTP.
   - Biasanya tidak full hypermedia.
   - Paling umum di enterprise.

4. **RPC-over-HTTP**
   - Endpoint adalah operation/function/command.
   - Biasanya `POST /operationName`.
   - Semantics utama ada di request body, bukan method/URI.

5. **GraphQL over HTTP**
   - Client mengirim query/mutation ke endpoint GraphQL.
   - Client memilih shape data.
   - Server menyediakan typed graph/schema.

6. **gRPC**
   - RPC framework dengan IDL/protobuf.
   - Umumnya memakai HTTP/2 framing.
   - Strongly typed dan codegen-heavy.

7. **Hypermedia API**
   - Response berisi link/action yang memandu client.
   - Client tidak hardcode semua transition URI.

8. **Event/Webhook API**
   - HTTP dipakai untuk delivery event/notification.
   - Bukan request-response query biasa.

9. **Hybrid API**
   - Kombinasi sadar beberapa style berdasarkan use case.

Top-tier backend engineer tidak fanatik pada satu style. Ia memahami consequence setiap style.

---

## 4. HTTP API vs REST API

Tidak semua HTTP API adalah REST API.

HTTP API hanya berarti:

> API menggunakan HTTP sebagai application protocol atau transport boundary.

REST API, dalam arti arsitektural, lebih spesifik:

1. Client-server separation.
2. Stateless interaction.
3. Cacheability.
4. Uniform interface.
5. Layered system.
6. Optional code-on-demand.

Dalam industri, istilah “REST API” sering dipakai untuk semua JSON-over-HTTP API. Itu umum, tapi secara mental model bisa menyesatkan.

### 4.1 Contoh HTTP API yang bukan REST

```http
POST /execute
Content-Type: application/json

{
  "operation": "approveCase",
  "caseId": "CASE-123",
  "reason": "Evidence complete"
}
```

Ini HTTP API, tapi bukan resource-oriented REST.

### 4.2 Contoh resource-oriented HTTP API

```http
POST /cases/CASE-123/approval-requests
Content-Type: application/json

{
  "reason": "Evidence complete"
}
```

Atau:

```http
POST /cases/CASE-123/approvals
Content-Type: application/json

{
  "decision": "APPROVE",
  "reason": "Evidence complete"
}
```

Ini lebih resource-oriented karena approval dibuat sebagai resource/event/decision.

### 4.3 Contoh state transition API

```http
POST /cases/CASE-123/transitions
Content-Type: application/json

{
  "transition": "APPROVE",
  "reason": "Evidence complete"
}
```

Ini hybrid: resource-oriented untuk transition collection, tapi tetap command-like.

Dalam workflow-heavy domain, hybrid seperti ini sering lebih jujur daripada memaksa `PATCH /cases/{id}` untuk semua transisi.

---

## 5. Resource-Oriented API

Resource-oriented API menjadikan resource sebagai pusat desain.

Resource bisa berupa:

1. Entity:
   - `/cases/{caseId}`
   - `/orders/{orderId}`
   - `/users/{userId}`

2. Collection:
   - `/cases`
   - `/orders`
   - `/users`

3. Sub-resource:
   - `/cases/{caseId}/evidence`
   - `/cases/{caseId}/assignments`
   - `/cases/{caseId}/notes`

4. Relationship:
   - `/cases/{caseId}/related-cases`
   - `/users/{userId}/roles`

5. Process resource:
   - `/export-jobs/{jobId}`
   - `/approval-requests/{requestId}`
   - `/case-transitions/{transitionId}`

6. Projection/read model:
   - `/case-dashboard`
   - `/case-work-queues`
   - `/investigator-inbox`

### 5.1 Kekuatan Resource-Oriented API

Kekuatan utama:

1. Cocok dengan HTTP method semantics.
2. Mudah dicache untuk read resource.
3. Mudah diobservasi berdasarkan method/path/status.
4. Mudah diamankan per resource.
5. Mudah dibuat dokumentasi OpenAPI.
6. Mudah dipahami oleh banyak tool dan developer.
7. Cocok untuk long-lived public API.
8. Cocok untuk CRUD plus bounded workflow.

### 5.2 Kelemahan Resource-Oriented API

Kelemahan:

1. Workflow kompleks bisa terasa dipaksa menjadi CRUD.
2. Operation multi-resource bisa sulit diekspresikan.
3. Bulk command bisa canggung.
4. Query kompleks bisa menghasilkan endpoint berlebihan.
5. Tanpa governance, URI bisa berubah menjadi campuran noun/verb kacau.
6. Client sering butuh banyak round-trip untuk data graph.

### 5.3 Kapan Cocok

Cocok untuk:

1. Public API.
2. Partner API.
3. Admin API.
4. Domain dengan resource jelas.
5. API yang perlu caching/conditional request.
6. API yang perlu auditability dan authorization per resource.
7. API yang dikonsumsi banyak jenis client.
8. API yang lifespan-nya panjang.

### 5.4 Kapan Kurang Cocok

Kurang cocok bila:

1. Operasi sangat command-centric.
2. Domain utamanya berupa procedure/action.
3. Latency antar service sangat ketat.
4. Schema internal perlu strongly typed codegen lintas bahasa.
5. Client butuh query graph yang sangat fleksibel.
6. API hanya internal antar-service dengan kontrak owner tunggal.

---

## 6. REST-ish JSON API: Realitas Enterprise

Banyak sistem enterprise sebenarnya memakai REST-ish JSON API, bukan REST ketat.

Ciri-ciri:

1. URI sebagian besar noun-based.
2. JSON sebagai representation utama.
3. GET/POST/PUT/PATCH/DELETE dipakai cukup benar.
4. Status code cukup bervariasi.
5. Error response distandardisasi.
6. Hypermedia jarang atau tidak dipakai.
7. OpenAPI menjadi kontrak utama.
8. Client hardcode endpoint.

Ini tidak otomatis buruk. Banyak API production sukses memakai style ini.

Yang berbahaya adalah ketika tim menyebutnya REST tetapi:

1. Semua request memakai POST.
2. Semua response `200 OK`.
3. Semua error ada di body.
4. URI penuh verb tanpa model resource.
5. Idempotency tidak jelas.
6. Caching tidak mungkin.
7. Authorization tidak resource-aware.
8. Observability path menjadi tidak bermakna.

### 6.1 Prinsip REST-ish yang Sehat

Kalau kamu tidak menerapkan REST ketat, minimal pertahankan prinsip berikut:

1. Resource identity jelas.
2. Method semantics tidak dilanggar.
3. Status code meaningful.
4. Error contract konsisten.
5. Idempotency eksplisit untuk command non-idempotent.
6. Authorization berbasis resource dan action.
7. URI stabil.
8. Versioning/evolution jelas.
9. OpenAPI akurat.
10. Observability tidak hancur.

---

## 7. RPC-over-HTTP

RPC-over-HTTP memperlakukan HTTP sebagai transport untuk memanggil operation.

Contoh:

```http
POST /approveCase
Content-Type: application/json

{
  "caseId": "CASE-123",
  "reason": "Evidence complete"
}
```

Atau:

```http
POST /cases.approve
Content-Type: application/json

{
  "caseId": "CASE-123",
  "reason": "Evidence complete"
}
```

Atau:

```http
POST /api
Content-Type: application/json

{
  "method": "CaseService.Approve",
  "params": {
    "caseId": "CASE-123",
    "reason": "Evidence complete"
  }
}
```

### 7.1 Kekuatan RPC-over-HTTP

Kekuatan:

1. Natural untuk command/action-heavy domain.
2. Simple mental model untuk service method.
3. Cocok untuk internal service dengan owner jelas.
4. Mudah merepresentasikan operation kompleks.
5. Tidak memaksa workflow menjadi CRUD palsu.
6. Cocok untuk batch command.
7. Cocok untuk operations yang tidak memiliki resource lifecycle jelas.

### 7.2 Kelemahan RPC-over-HTTP

Kelemahan:

1. Mengabaikan banyak HTTP semantics.
2. Caching sulit.
3. Idempotency harus dibuat manual.
4. Status code sering jadi tidak konsisten.
5. URI observability kurang bermakna jika semua ke `/execute`.
6. Authorization harus lebih disiplin karena resource tidak eksplisit.
7. Tooling HTTP umum kurang maksimal.
8. Bisa menjadi dumping ground untuk semua command.

### 7.3 RPC-over-HTTP yang Sehat

RPC-over-HTTP bisa sehat bila:

1. Operation name stabil dan jelas.
2. Status code tetap meaningful.
3. Error contract konsisten.
4. Idempotency-key dipakai untuk command yang perlu retry safety.
5. Authorization tetap memeriksa resource target.
6. Request/response schema terdokumentasi.
7. Observability tag mencatat operation name.
8. Rate limit berbasis operation cost.
9. Audit event eksplisit.
10. Endpoint tidak semua ditunnel ke satu `/execute` tanpa visibility.

### 7.4 Contoh RPC yang Lebih Baik

```http
POST /case-commands/approve
Idempotency-Key: 7bd3c5d3-0df0-456e-b0c7-fb8cbe49f6f7
Content-Type: application/json

{
  "caseId": "CASE-123",
  "expectedVersion": 17,
  "reason": "Evidence complete"
}
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "caseId": "CASE-123",
  "newStatus": "APPROVED",
  "version": 18,
  "auditEventId": "EVT-9001"
}
```

Ini RPC-ish, tapi tetap:

1. Idempotency jelas.
2. Concurrency jelas.
3. Status meaningful.
4. Audit eksplisit.
5. Response operable.

---

## 8. Command Resource Pattern

Untuk workflow-heavy systems, ada pattern penting:

> Representasikan command/action sebagai resource atau sub-resource, bukan sebagai verb liar.

Contoh buruk:

```http
POST /approveCase
```

Contoh lebih baik:

```http
POST /cases/CASE-123/approval-requests
```

Atau:

```http
POST /cases/CASE-123/transitions
```

Atau:

```http
POST /case-commands
```

Dengan body:

```json
{
  "type": "APPROVE_CASE",
  "caseId": "CASE-123",
  "expectedVersion": 17,
  "reason": "Evidence complete"
}
```

### 8.1 Kenapa Ini Berguna

Command resource memberi kamu:

1. Identitas command.
2. Audit trail natural.
3. Idempotency target.
4. Async processing path.
5. Retry/replay support.
6. Status tracking.
7. Authorization decision point.
8. Error diagnosis.
9. Observability.

### 8.2 Async Command Resource

Request:

```http
POST /cases/CASE-123/transitions
Idempotency-Key: 441d3d01-7a5e-4a33-a5c3-c53e0188a5e5
Content-Type: application/json

{
  "transition": "APPROVE",
  "expectedVersion": 17,
  "reason": "Evidence complete"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /case-transition-jobs/JOB-789
Content-Type: application/json

{
  "jobId": "JOB-789",
  "status": "ACCEPTED"
}
```

Client poll:

```http
GET /case-transition-jobs/JOB-789
```

Response:

```json
{
  "jobId": "JOB-789",
  "status": "COMPLETED",
  "caseId": "CASE-123",
  "newCaseStatus": "APPROVED",
  "auditEventId": "EVT-9001"
}
```

Ini lebih production-grade daripada memaksa satu synchronous `PATCH /cases/{id}` untuk operation yang mungkin long-running.

---

## 9. GraphQL over HTTP

GraphQL adalah query language dan runtime untuk API. Dalam praktik web, GraphQL sering disajikan melalui HTTP endpoint seperti:

```http
POST /graphql
Content-Type: application/json
Accept: application/graphql-response+json

{
  "query": "query($id: ID!) { case(id: $id) { id status assignee { id name } evidence { id filename } } }",
  "variables": { "id": "CASE-123" }
}
```

### 9.1 Mental Model

Resource-oriented HTTP API biasanya server menentukan endpoint dan response shape.

GraphQL membalik sebagian kontrol:

> Server menyediakan schema graph; client memilih field yang dibutuhkan.

### 9.2 Kekuatan GraphQL

GraphQL cocok untuk:

1. UI yang butuh data graph kompleks.
2. Banyak client dengan kebutuhan field berbeda.
3. Mengurangi over-fetching dan under-fetching.
4. Frontend aggregation dari banyak resource.
5. Strong schema dan introspection.
6. Developer experience untuk query exploration.
7. Evolusi additive fields.

### 9.3 Kelemahan GraphQL

Risiko GraphQL:

1. Caching HTTP lebih sulit karena endpoint tunggal.
2. Observability per operation harus dibuat khusus.
3. Authorization field-level/object-level menjadi kompleks.
4. Query complexity bisa menyebabkan DoS.
5. N+1 query problem.
6. Error semantics HTTP sering kurang granular.
7. Rate limiting per request tidak cukup; harus cost-based.
8. File upload bukan kekuatan utama GraphQL.
9. Long-running mutation perlu desain hati-hati.
10. Public schema bisa mengekspos domain terlalu banyak bila governance lemah.

### 9.4 GraphQL Query vs Mutation

Query untuk read:

```graphql
query CaseDetail($id: ID!) {
  case(id: $id) {
    id
    status
    assignedInvestigator {
      id
      displayName
    }
    evidence(first: 20) {
      nodes {
        id
        filename
        uploadedAt
      }
    }
  }
}
```

Mutation untuk command:

```graphql
mutation ApproveCase($input: ApproveCaseInput!) {
  approveCase(input: $input) {
    case {
      id
      status
      version
    }
    auditEventId
  }
}
```

### 9.5 Backend Requirements untuk GraphQL Production

Minimal:

1. Persisted queries untuk public/high-traffic API.
2. Query depth limit.
3. Query complexity scoring.
4. Field-level authorization.
5. Object-level authorization.
6. DataLoader/batching untuk mencegah N+1.
7. Operation name wajib untuk observability.
8. Structured GraphQL errors.
9. Tracing per resolver.
10. Rate limit berbasis cost.
11. Schema governance.
12. Deprecation policy.
13. Disable unrestricted introspection bila threat model menuntut.
14. Separate read-heavy GraphQL dari command-critical workflows bila perlu.

### 9.6 Kapan GraphQL Cocok

Cocok bila:

1. Banyak UI screen dengan shape berbeda.
2. Client perlu memilih field.
3. Banyak aggregate read.
4. Backend punya schema governance kuat.
5. Tim siap membangun authorization/complexity/observability tambahan.

### 9.7 Kapan GraphQL Kurang Cocok

Kurang cocok bila:

1. API publik sederhana resource-oriented.
2. Domain command-heavy dan audit-heavy.
3. File transfer besar dominan.
4. Caching HTTP/CDN sangat penting.
5. Team belum siap dengan query complexity/security.
6. Regulatory defensibility butuh endpoint command eksplisit dan mudah diaudit.

### 9.8 GraphQL untuk Regulatory Platform

GraphQL bisa sangat baik untuk read model:

1. Case detail page.
2. Dashboard.
3. Investigator work queue.
4. Supervisor overview.
5. Timeline aggregation.

Namun untuk command kritikal seperti approve, revoke, sanction, close, escalate, saya cenderung tetap memakai explicit HTTP command/resource endpoint karena:

1. Idempotency lebih eksplisit.
2. Status code lebih precise.
3. Audit lebih sederhana.
4. Authorization policy lebih mudah dibuktikan.
5. Observability per operation lebih jelas.

Hybrid yang sehat:

- GraphQL untuk read aggregation.
- REST/resource/command API untuk state-changing workflow.

---

## 10. gRPC

gRPC adalah RPC framework modern yang biasanya menggunakan Protocol Buffers dan HTTP/2 sebagai transport framing.

Contoh `.proto`:

```proto
syntax = "proto3";

package enforcement.case.v1;

service CaseCommandService {
  rpc ApproveCase(ApproveCaseRequest) returns (ApproveCaseResponse);
  rpc EscalateCase(EscalateCaseRequest) returns (EscalateCaseResponse);
}

message ApproveCaseRequest {
  string case_id = 1;
  int64 expected_version = 2;
  string reason = 3;
  string idempotency_key = 4;
}

message ApproveCaseResponse {
  string case_id = 1;
  string new_status = 2;
  int64 version = 3;
  string audit_event_id = 4;
}
```

### 10.1 Kekuatan gRPC

Kekuatan:

1. Strong typing dengan IDL.
2. Code generation lintas bahasa.
3. Efficient binary serialization.
4. HTTP/2 multiplexing.
5. Streaming support:
   - unary
   - server streaming
   - client streaming
   - bidirectional streaming
6. Cocok untuk internal microservices.
7. Contract-first.
8. Deadline/cancellation model cukup natural.
9. Interceptor untuk auth/tracing/logging.
10. Backward compatibility protobuf lebih formal.

### 10.2 Kelemahan gRPC

Kelemahan:

1. Browser support langsung terbatas dibanding JSON/HTTP biasa.
2. Debugging manual lebih sulit daripada curl JSON.
3. CDN/browser caching HTTP tidak natural.
4. Public API lebih sulit untuk partner yang tidak siap tooling.
5. Error model berbeda dari HTTP status biasa.
6. Protobuf evolution punya aturan sendiri.
7. Load balancer/proxy harus paham HTTP/2/gRPC.
8. Observability harus gRPC-aware.
9. JSON ecosystem/tooling umum tidak langsung cocok.

### 10.3 Kapan gRPC Cocok

Cocok bila:

1. Internal service-to-service.
2. Latency/throughput penting.
3. Polyglot service butuh generated clients.
4. Contract ownership kuat.
5. Streaming antar-service.
6. Mobile/backend tertentu dengan generated client.
7. Schema evolution diatur disiplin.

### 10.4 Kapan gRPC Kurang Cocok

Kurang cocok bila:

1. Public partner API yang harus mudah dicoba via browser/curl.
2. API butuh HTTP caching/CDN semantics.
3. Consumer tidak punya tooling gRPC.
4. Domain butuh resource-oriented web interoperability.
5. Debuggability manual lebih penting dari binary efficiency.
6. API gateway organisasi belum siap gRPC.

### 10.5 gRPC dan HTTP Semantics

gRPC memakai HTTP/2, tetapi tidak memakai HTTP semantics seperti resource-oriented API. gRPC membawa semantics RPC sendiri:

1. Service.
2. Method.
3. Request message.
4. Response message.
5. Status/trailers.
6. Metadata.

Jadi gRPC adalah “over HTTP/2” tetapi bukan “HTTP API” dalam sense resource/method/status/caching yang sama.

### 10.6 gRPC untuk Regulatory Platform

Cocok untuk internal:

1. Case service ke document service.
2. Case service ke identity service.
3. Workflow engine ke notification service.
4. Analytics ingestion.
5. Rule engine calls.
6. Internal streaming event feed.

Kurang ideal untuk:

1. Public regulator portal API.
2. Partner integration sederhana.
3. Browser-admin UI langsung.
4. Evidence download/upload besar yang lebih cocok object storage + HTTP.

---

## 11. Hypermedia API

Hypermedia API mengembalikan links/actions di response agar client dapat menemukan next possible actions.

Contoh:

```json
{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "assignee": "USR-9",
  "links": {
    "self": { "href": "/cases/CASE-123" },
    "evidence": { "href": "/cases/CASE-123/evidence" },
    "timeline": { "href": "/cases/CASE-123/timeline" }
  },
  "actions": {
    "approve": {
      "method": "POST",
      "href": "/cases/CASE-123/transitions",
      "schema": {
        "transition": "APPROVE",
        "required": ["reason", "expectedVersion"]
      }
    },
    "requestMoreEvidence": {
      "method": "POST",
      "href": "/cases/CASE-123/transitions",
      "schema": {
        "transition": "REQUEST_MORE_EVIDENCE",
        "required": ["reason", "dueDate"]
      }
    }
  }
}
```

### 11.1 Kekuatan Hypermedia

Kekuatan:

1. Client bisa mengikuti state transition yang tersedia.
2. Server bisa menyembunyikan action yang tidak allowed.
3. Cocok untuk workflow/state-machine domain.
4. Mengurangi hardcoded client behavior.
5. Meningkatkan discoverability.
6. Bisa membantu authorization-aware UI.

### 11.2 Kelemahan Hypermedia

Kelemahan:

1. Client lebih kompleks.
2. Tooling umum tidak selalu bagus.
3. Banyak tim belum familiar.
4. API docs tetap diperlukan.
5. Tidak semua consumer ingin dynamic navigation.
6. Bisa over-engineered untuk API sederhana.

### 11.3 Hypermedia untuk Workflow

Dalam workflow-heavy systems, hypermedia sangat menarik karena available actions bergantung pada:

1. Case status.
2. User role.
3. Tenant policy.
4. Evidence completeness.
5. Regulatory deadline.
6. Legal hold.
7. Conflict/precondition.

Daripada client menebak:

```text
IF status == UNDER_REVIEW AND role == SUPERVISOR THEN show approve button
```

Server bisa menyatakan:

```json
"actions": {
  "approve": { "method": "POST", "href": "/cases/CASE-123/transitions" }
}
```

Namun jangan jadikan hypermedia pengganti authorization. Server tetap harus enforce permission saat action dipanggil.

---

## 12. Event/Webhook API over HTTP

Webhook adalah HTTP API di mana server kamu menjadi client yang mengirim event ke consumer.

Contoh event delivery:

```http
POST /partner/webhooks/enforcement-events
Content-Type: application/json
X-Event-Type: case.approved
X-Event-Id: EVT-9001
X-Signature: sha256=...

{
  "eventId": "EVT-9001",
  "type": "case.approved",
  "occurredAt": "2026-06-19T10:15:00Z",
  "caseId": "CASE-123"
}
```

### 12.1 Webhook Design Concerns

Webhook butuh:

1. Event identity.
2. Idempotent consumer expectation.
3. Signature verification.
4. Retry policy.
5. Backoff.
6. Dead letter handling.
7. Delivery status tracking.
8. Secret rotation.
9. Replay window.
10. Ordering expectation.
11. Schema versioning.
12. Security logging.

Webhook bukan sekadar “POST JSON ke URL customer”. Ia adalah distributed delivery contract.

### 12.2 Kapan Webhook Cocok

Cocok untuk:

1. Partner notification.
2. Async business events.
3. Integration after state change.
4. External automation.
5. Cross-organization workflow.

Kurang cocok untuk:

1. Strong consistency command.
2. Synchronous decision.
3. Data transfer besar.
4. Consumer yang tidak bisa expose endpoint stabil.

---

## 13. API Style Berdasarkan Domain Shape

### 13.1 CRUD-heavy Domain

Contoh:

1. user management.
2. product catalog.
3. document metadata.
4. reference data.

Style cocok:

1. Resource-oriented REST-ish.
2. OpenAPI.
3. HTTP caching untuk read.
4. Conditional update dengan ETag.

### 13.2 Workflow-heavy Domain

Contoh:

1. enforcement case lifecycle.
2. approval process.
3. claims processing.
4. investigation workflow.
5. onboarding review.

Style cocok:

1. Resource-oriented core entities.
2. Command resources untuk transitions.
3. Hypermedia optional untuk available actions.
4. Event/webhook untuk notifications.
5. GraphQL optional untuk read aggregation.

### 13.3 Query-heavy Domain

Contoh:

1. dashboards.
2. analytics exploration.
3. search.
4. case overview screens.

Style cocok:

1. GraphQL untuk flexible UI read.
2. Dedicated query endpoints.
3. Search-style POST endpoint bila query terlalu kompleks untuk URL.
4. Async export job untuk large result.

### 13.4 Low-latency Internal Service Domain

Contoh:

1. risk scoring service.
2. identity service.
3. rule evaluation.
4. internal pricing.

Style cocok:

1. gRPC.
2. Internal REST-ish if simpler.
3. Strict deadline/cancellation.
4. Strong observability.

### 13.5 Integration/Partner Domain

Contoh:

1. partner case submission.
2. status lookup.
3. evidence upload.
4. event notification.

Style cocok:

1. REST-ish JSON over HTTP.
2. Webhook events.
3. Object storage signed upload/download.
4. Strong OpenAPI contract.
5. Conservative versioning.

---

## 14. API Style Decision Matrix

| Criterion | Resource-Oriented | RPC-over-HTTP | GraphQL | gRPC | Hypermedia |
|---|---:|---:|---:|---:|---:|
| Public API friendliness | High | Medium | Medium | Low-Medium | Medium |
| Internal service efficiency | Medium | Medium | Medium | High | Low-Medium |
| HTTP caching fit | High | Low | Low-Medium | Low | High |
| Workflow command clarity | Medium | High | Medium | High | High |
| Query flexibility | Medium | Low | High | Low-Medium | Medium |
| Tooling simplicity | High | High | Medium | Medium | Low-Medium |
| Browser direct usage | High | High | High | Low | Medium |
| Strong typing/codegen | Medium | Medium | High | High | Low-Medium |
| Observability default | High | Medium | Low-Medium | Medium | Medium |
| Authorization complexity | Medium | Medium | High | Medium | Medium |
| CDN compatibility | High | Low | Low-Medium | Low | Medium |
| Long-lived contract governance | High | Medium | High | High | Medium |
| Learning curve | Medium | Low | Medium-High | Medium-High | High |

Interpretasi:

- Tidak ada style yang unggul semua aspek.
- Pilih berdasarkan constraint yang dominan.
- Hybrid sering paling realistis, tapi harus governed.

---

## 15. Common Anti-Patterns

### 15.1 REST Cosplay

Ciri:

```http
POST /cases/get
POST /cases/update
POST /cases/delete
```

Masalah:

1. Method semantics hilang.
2. Cache tidak bisa.
3. Retry tidak jelas.
4. Observability buruk.
5. Client behavior tidak standar.

Lebih baik:

```http
GET /cases/{id}
PATCH /cases/{id}
DELETE /cases/{id}
```

Atau untuk workflow:

```http
POST /cases/{id}/transitions
```

### 15.2 All-in-One Endpoint

```http
POST /api

{
  "operation": "anything"
}
```

Masalah:

1. Gateway tidak bisa route/rate-limit dengan baik.
2. Metrics path tidak berguna.
3. Authorization mudah bocor.
4. OpenAPI tidak natural.
5. API governance melemah.

### 15.3 GraphQL untuk Semua Hal

Masalah:

1. Mutation kritikal jadi sulit diaudit.
2. Query complexity jadi attack surface.
3. HTTP status sering terlalu generik.
4. Cache/CDN sulit.
5. File transfer awkward.

GraphQL powerful, tapi bukan pengganti semua API.

### 15.4 gRPC untuk Public API Tanpa Consumer Readiness

Masalah:

1. Partner kesulitan tooling.
2. Browser/curl/debugging tidak mudah.
3. Gateway/CDN belum siap.
4. Error support berbeda.

### 15.5 CRUD Palsu untuk Workflow

```http
PATCH /cases/CASE-123

{
  "status": "APPROVED"
}
```

Padahal approval butuh:

1. Role check.
2. Evidence completeness.
3. Legal deadline.
4. Version precondition.
5. Audit reason.
6. Notification.
7. Document generation.

Lebih jelas:

```http
POST /cases/CASE-123/transitions

{
  "transition": "APPROVE",
  "expectedVersion": 17,
  "reason": "Evidence complete"
}
```

### 15.6 Style Mixing Tanpa Rule

Contoh buruk:

```http
POST /cases/approve
PATCH /case/{id}/status
POST /caseApproval
POST /workflow/execute
```

Masalah:

1. Tidak ada consistency.
2. Client bingung.
3. Security policy sulit.
4. Docs sulit.
5. Testing matrix meledak.

Hybrid boleh, chaos tidak.

---

## 16. Backend Design Heuristics

### 16.1 Mulai dari Domain, Bukan URL

Tanyakan:

1. Apa resource utama?
2. Apa command utama?
3. Apa query utama?
4. Apa event utama?
5. Apa invariant utama?
6. Apa failure mode utama?
7. Siapa consumer?
8. Apakah API public/internal?
9. Apakah caching penting?
10. Apakah typed codegen penting?

### 16.2 Pisahkan Read, Command, Event

Dalam sistem kompleks, API sering lebih bersih jika dipisah:

1. Read API:
   - GET resource.
   - Search/query.
   - GraphQL/read model.

2. Command API:
   - POST command/transition resource.
   - Idempotency key.
   - Optimistic concurrency.

3. Event API:
   - webhook.
   - SSE.
   - event stream.

Ini mirip CQRS secara API surface, walaupun backend internal tidak harus full CQRS.

### 16.3 Gunakan HTTP Semantics Saat Memberi Nilai

Gunakan:

1. GET untuk safe retrieval.
2. POST untuk create/process command.
3. PUT untuk replace.
4. PATCH untuk partial update.
5. DELETE untuk remove/cancel/tombstone sesuai semantics.
6. ETag/If-Match untuk concurrency.
7. Cache-Control untuk freshness.
8. 202 + Location untuk async.
9. 409/412 untuk conflict/precondition.
10. 429 untuk rate limit.
11. 503 + Retry-After untuk overload.

Jangan memaksakan HTTP semantics untuk hal yang memang RPC internal murni. Tapi kalau kamu memilih RPC, ganti semantics yang hilang dengan kontrak eksplisit.

---

## 17. Java/Spring Mapping

### 17.1 Resource-Oriented Spring MVC

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseQueryService queryService;
    private final CaseCommandService commandService;

    CaseController(CaseQueryService queryService, CaseCommandService commandService) {
        this.queryService = queryService;
        this.commandService = commandService;
    }

    @GetMapping("/{caseId}")
    ResponseEntity<CaseResponse> getCase(
            @PathVariable String caseId,
            @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch
    ) {
        CaseRepresentation representation = queryService.getCase(caseId);

        String etag = "\"case-" + representation.version() + "\"";
        if (etag.equals(ifNoneMatch)) {
            return ResponseEntity.status(304)
                    .eTag(etag)
                    .build();
        }

        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.noCache())
                .body(representation.body());
    }

    @PostMapping("/{caseId}/transitions")
    ResponseEntity<CaseTransitionResponse> transition(
            @PathVariable String caseId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CaseTransitionRequest request
    ) {
        CaseTransitionResult result = commandService.transition(
                caseId,
                idempotencyKey,
                request.transition(),
                request.expectedVersion(),
                request.reason()
        );

        return ResponseEntity.ok(new CaseTransitionResponse(
                result.caseId(),
                result.newStatus(),
                result.version(),
                result.auditEventId()
        ));
    }
}
```

### 17.2 RPC-ish Spring MVC

```java
@RestController
@RequestMapping("/case-commands")
class CaseCommandController {

    private final CaseCommandService service;

    CaseCommandController(CaseCommandService service) {
        this.service = service;
    }

    @PostMapping("/approve")
    ResponseEntity<ApproveCaseResponse> approve(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody ApproveCaseRequest request
    ) {
        ApproveCaseResult result = service.approve(
                request.caseId(),
                request.expectedVersion(),
                request.reason(),
                idempotencyKey
        );

        return ResponseEntity.ok(new ApproveCaseResponse(
                result.caseId(),
                result.status(),
                result.version(),
                result.auditEventId()
        ));
    }
}
```

Ini bukan resource-oriented murni, tapi bisa sehat bila governance jelas.

### 17.3 GraphQL Java/Spring Conceptual Resolver

```java
@Controller
class CaseGraphqlController {

    private final CaseQueryService caseQueryService;
    private final AuthorizationService authorizationService;

    @QueryMapping
    CaseDetail caseById(@Argument String id, Authentication authentication) {
        authorizationService.requireCanViewCase(authentication, id);
        return caseQueryService.getCaseDetail(id);
    }

    @MutationMapping
    ApproveCasePayload approveCase(
            @Argument ApproveCaseInput input,
            Authentication authentication
    ) {
        authorizationService.requireCanApproveCase(authentication, input.caseId());
        return caseQueryService.approveCase(input);
    }
}
```

Important: GraphQL resolver tetap harus enforce authorization. Jangan mengandalkan UI hiding atau schema saja.

### 17.4 gRPC Java Conceptual Service

```java
public final class CaseCommandGrpcService extends CaseCommandServiceGrpc.CaseCommandServiceImplBase {

    private final CaseCommandApplicationService service;

    public CaseCommandGrpcService(CaseCommandApplicationService service) {
        this.service = service;
    }

    @Override
    public void approveCase(
            ApproveCaseRequest request,
            StreamObserver<ApproveCaseResponse> responseObserver
    ) {
        try {
            ApproveCaseResult result = service.approve(
                    request.getCaseId(),
                    request.getExpectedVersion(),
                    request.getReason(),
                    request.getIdempotencyKey()
            );

            ApproveCaseResponse response = ApproveCaseResponse.newBuilder()
                    .setCaseId(result.caseId())
                    .setNewStatus(result.status())
                    .setVersion(result.version())
                    .setAuditEventId(result.auditEventId())
                    .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (CaseConflictException ex) {
            responseObserver.onError(
                    Status.FAILED_PRECONDITION
                            .withDescription("Case version conflict")
                            .asRuntimeException()
            );
        }
    }
}
```

---

## 18. OpenAPI, GraphQL Schema, Proto: Contract Surface

Setiap style punya contract artifact:

1. Resource-oriented HTTP:
   - OpenAPI.
   - JSON Schema.
   - Problem Details schema.

2. GraphQL:
   - GraphQL schema.
   - persisted operation registry.
   - schema deprecation.

3. gRPC:
   - `.proto` files.
   - generated code.
   - protobuf compatibility rules.

4. Webhook:
   - event schema.
   - signature spec.
   - retry policy spec.

Contract artifact harus dianggap production asset, bukan dokumentasi sekunder.

Governance minimal:

1. Linting.
2. Breaking change detection.
3. Review checklist.
4. Versioning policy.
5. Error model standard.
6. Security requirements.
7. Observability naming.
8. Deprecation lifecycle.

---

## 19. API Style and Observability

### 19.1 Resource-Oriented

Metrics natural:

```text
http.server.requests{method="GET", route="/cases/{caseId}", status="200"}
http.server.requests{method="POST", route="/cases/{caseId}/transitions", status="409"}
```

Good default visibility.

### 19.2 RPC-over-HTTP

Need operation tag:

```text
http.server.requests{method="POST", route="/case-commands/approve", operation="ApproveCase", status="200"}
```

If all routed to `/api`, operation tag becomes mandatory.

### 19.3 GraphQL

Need:

1. Operation name.
2. Query complexity.
3. Resolver timing.
4. Field error count.
5. DataLoader batch metrics.
6. Auth denial by field/resource.

Bad:

```text
POST /graphql 200
POST /graphql 200
POST /graphql 200
```

Good:

```text
graphql.operation{name="CaseDetail", type="query", status="success"}
graphql.operation{name="ApproveCase", type="mutation", status="error", error="FORBIDDEN"}
```

### 19.4 gRPC

Need:

1. Service name.
2. Method name.
3. gRPC status code.
4. Deadline exceeded count.
5. Stream duration.
6. Message size.
7. Metadata propagation.

---

## 20. API Style and Authorization

### 20.1 Resource-Oriented

Authorization maps naturally:

```text
Can user VIEW case CASE-123?
Can user TRANSITION case CASE-123 to APPROVED?
Can user UPLOAD evidence to case CASE-123?
```

### 20.2 RPC-over-HTTP

Must extract target resource from body:

```json
{
  "caseId": "CASE-123",
  "operation": "APPROVE"
}
```

Risk:

1. Gateway cannot enforce object-level authorization easily.
2. Logs may not capture target resource.
3. Policy can be hidden inside application.

### 20.3 GraphQL

Authorization can be:

1. operation-level.
2. field-level.
3. object-level.
4. edge-level.
5. aggregate-level.

Example problem:

```graphql
query {
  case(id: "CASE-123") {
    id
    confidentialNotes
    respondentPersonalData
  }
}
```

Viewing the case does not automatically imply viewing every field.

### 20.4 gRPC

Authorization usually in interceptor + service method:

1. Interceptor authenticates caller.
2. Service method checks object/action permission.
3. Downstream propagates service/user context carefully.

---

## 21. API Style and Caching

### 21.1 Resource-Oriented

Best fit:

```http
GET /public-guidance-documents/GD-123
Cache-Control: public, max-age=3600
ETag: "gd-123-v5"
```

### 21.2 RPC-over-HTTP

Usually poor fit, unless explicitly designed:

```http
POST /searchCases
```

Could be cacheable only with special cache layer, not standard shared HTTP cache in most deployments.

### 21.3 GraphQL

Challenges:

1. Endpoint single `/graphql`.
2. POST common.
3. Query body determines response.
4. Authorization-specific fields.
5. Vary complexity.

Possible mitigations:

1. Persisted query ID.
2. GET for safe queries where supported.
3. Edge cache by operation/variables/user segment.
4. Application-level normalized cache.

### 21.4 gRPC

Usually not HTTP-cache oriented. Use application cache, client cache, or service cache.

---

## 22. API Style and Versioning

### 22.1 Resource-Oriented HTTP

Versioning options:

1. URI version:
   - `/v1/cases`
2. Header version:
   - `API-Version: 2026-06-01`
3. Media type version:
   - `application/vnd.company.case.v1+json`
4. Compatible evolution without explicit version.

### 22.2 GraphQL

Often schema evolves additively:

1. Add fields.
2. Deprecate fields.
3. Avoid breaking type changes.
4. Track client operations.
5. Use schema registry.

### 22.3 gRPC/Protobuf

Compatibility depends on protobuf rules:

1. Never reuse field numbers.
2. Reserve removed fields.
3. Add optional fields safely.
4. Avoid changing field meaning.
5. Version packages/services when necessary.

### 22.4 RPC-over-HTTP

Needs explicit versioning discipline because operation contracts can drift silently.

---

## 23. Regulatory Case Management Example

Domain:

1. Case is submitted.
2. Case is assigned.
3. Evidence is uploaded.
4. Investigator reviews.
5. Supervisor approves/escalates.
6. Legal reviewer validates.
7. Decision is issued.
8. Respondent may appeal.
9. Case can be reopened.

### 23.1 Resource-Oriented Core

```http
GET /cases/{caseId}
GET /cases/{caseId}/timeline
GET /cases/{caseId}/evidence
POST /cases/{caseId}/evidence
GET /cases/{caseId}/assignments
POST /cases/{caseId}/assignments
```

### 23.2 Command/Transition Resource

```http
POST /cases/{caseId}/transitions

{
  "transition": "ESCALATE_TO_LEGAL",
  "expectedVersion": 12,
  "reason": "Potential statutory breach"
}
```

### 23.3 Async Export

```http
POST /case-export-jobs

{
  "filter": {
    "status": ["APPROVED", "ESCALATED"],
    "fromDate": "2026-01-01",
    "toDate": "2026-06-30"
  },
  "format": "CSV"
}
```

Response:

```http
202 Accepted
Location: /case-export-jobs/JOB-123
```

### 23.4 GraphQL Read Aggregation

```graphql
query InvestigatorDashboard($investigatorId: ID!) {
  investigator(id: $investigatorId) {
    id
    displayName
    workQueue {
      caseId
      status
      priority
      dueAt
      respondent {
        name
      }
      latestEvent {
        type
        occurredAt
      }
    }
  }
}
```

### 23.5 gRPC Internal Rule Engine

```proto
service EnforcementRuleService {
  rpc EvaluateTransition(EvaluateTransitionRequest) returns (EvaluateTransitionResponse);
}
```

### 23.6 Webhook Partner Event

```http
POST /partner-webhooks/enforcement-events
X-Event-Type: case.decision_issued
X-Event-Id: EVT-123
X-Signature: sha256=...
```

### 23.7 Healthy Hybrid Architecture

| Concern | Recommended Style |
|---|---|
| Public case lookup | Resource-oriented HTTP |
| Evidence upload/download | HTTP + object storage signed URL |
| Case state transition | Command resource over HTTP |
| Internal service rule evaluation | gRPC |
| UI dashboard aggregation | GraphQL or dedicated read API |
| Partner notification | Webhook |
| Large report generation | Async job resource |
| Audit event retrieval | Resource-oriented HTTP |

This is not style chaos. This is style separation by responsibility.

---

## 24. Style Selection Checklist

Before choosing style, answer:

### 24.1 Consumer

1. Who consumes this API?
2. Browser UI?
3. Mobile app?
4. Partner?
5. Internal service?
6. Batch job?
7. Unknown future consumers?

### 24.2 Domain

1. Is domain resource-heavy?
2. Command-heavy?
3. Query-heavy?
4. Event-heavy?
5. Workflow-heavy?
6. Low-latency internal?

### 24.3 Operations

1. Need caching?
2. Need CDN?
3. Need simple curl debugging?
4. Need generated clients?
5. Need streaming?
6. Need strict schema evolution?
7. Need rate limit by cost?
8. Need auditability?
9. Need per-resource authorization?

### 24.4 Governance

1. Does team have API guidelines?
2. Is OpenAPI/GraphQL/proto linted?
3. Are breaking changes detected?
4. Are errors standardized?
5. Are status codes standardized?
6. Are observability tags standardized?
7. Are authz patterns standardized?

---

## 25. Practical Decision Framework

### 25.1 Default for External APIs

Start with:

1. REST-ish resource-oriented HTTP.
2. OpenAPI.
3. Problem Details.
4. Explicit idempotency for unsafe commands.
5. Async job resources for long-running work.
6. Webhook for external events.

Add GraphQL only when read aggregation/flexible clients justify complexity.

Avoid public gRPC unless consumers are known and capable.

### 25.2 Default for Internal Service-to-Service

Start with:

1. HTTP/JSON if simplicity and debugging matter.
2. gRPC if strong contracts/performance/streaming matter.
3. Shared reliability standards either way:
   - deadline.
   - retry.
   - idempotency.
   - auth.
   - tracing.
   - metrics.

### 25.3 Default for Workflow Systems

Use:

1. Resource-oriented read API.
2. Explicit command/transition resource.
3. ETag/expectedVersion.
4. Idempotency-Key.
5. Audit event ID in response.
6. Hypermedia actions optional.
7. Webhook/event stream for notifications.
8. GraphQL only for read models if helpful.

---

## 26. Design Review Rubric

A good API style decision should be defendable with these statements:

1. We chose this style because the consumer shape is `X`.
2. We chose this style because the domain operation shape is `Y`.
3. We know which HTTP semantics we use and which we do not.
4. We have explicit replacement contracts where HTTP semantics are not used.
5. We know how retry/idempotency works.
6. We know how authorization works.
7. We know how caching works or why it does not apply.
8. We know how errors are represented.
9. We know how observability identifies operation/resource.
10. We know how contracts evolve without breaking consumers.
11. We know how gateway/proxy sees this traffic.
12. We know how to test this contract.

If the team cannot answer these, API style is not mature yet.

---

## 27. Exercises

### Exercise 1 — Identify the Real Style

Classify these APIs:

```http
GET /cases/CASE-123
```

```http
POST /caseService/approveCase
```

```http
POST /graphql
```

```http
POST /cases/CASE-123/transitions
```

```proto
service CaseService {
  rpc ApproveCase(ApproveCaseRequest) returns (ApproveCaseResponse);
}
```

For each, answer:

1. What style is it?
2. What HTTP semantics are used?
3. What semantics are application-defined?
4. How would you implement idempotency?
5. How would you authorize it?

### Exercise 2 — Redesign CRUD Palsu

Given:

```http
PATCH /cases/CASE-123

{
  "status": "APPROVED"
}
```

Redesign for:

1. Optimistic concurrency.
2. Idempotency.
3. Audit reason.
4. Async approval.
5. 409/412 conflict handling.
6. Authorization.

### Exercise 3 — Choose Style for Use Cases

Choose style for:

1. Public partner case submission.
2. Internal fraud scoring service.
3. Investigator dashboard UI.
4. Evidence file upload.
5. Case status webhook to partner.
6. Legal review transition.
7. Public reference data catalog.

Justify trade-offs.

### Exercise 4 — Observability Plan

For a GraphQL endpoint `/graphql`, design metrics and logs that allow you to answer:

1. Which operation is slow?
2. Which field/resolver causes latency?
3. Which user/tenant hits complexity limit?
4. Which mutation fails authorization?
5. Which downstream service causes N+1 amplification?

### Exercise 5 — Hybrid Governance

Create a rule set:

1. When to use resource endpoint.
2. When to use command resource.
3. When to use GraphQL.
4. When to use gRPC.
5. When to use webhook.
6. Required headers/status/error behavior for each.

---

## 28. Key Takeaways

1. API style is a contract decision, not a naming preference.
2. HTTP gives semantics; some styles use them deeply, some bypass them.
3. Resource-oriented HTTP is the safest default for external, long-lived APIs.
4. RPC-over-HTTP can be valid for command-heavy domains if governed.
5. GraphQL is powerful for flexible read aggregation but adds security/observability/caching complexity.
6. gRPC is strong for internal service-to-service contracts, not always ideal for public/browser-facing APIs.
7. Hypermedia can be valuable for workflow/state-machine systems, but raises client complexity.
8. Webhooks are async delivery contracts, not casual POST callbacks.
9. Workflow-heavy systems often benefit from command resources and explicit transition endpoints.
10. Hybrid architecture is fine when boundaries are explicit and governed.
11. The worst design is not choosing the “wrong” style; it is mixing styles unconsciously and losing semantics.

---

## 29. References

- RFC 9110 — HTTP Semantics.
- RFC 9111 — HTTP Caching.
- GraphQL over HTTP specification draft.
- GraphQL official documentation: Serving over HTTP.
- gRPC official documentation.
- gRPC over HTTP/2 protocol documentation.
- Microsoft Azure Architecture Center: Web API design best practices.
- Spring Framework documentation: Web MVC, WebFlux, REST clients, GraphQL integration.
- OWASP API Security Top 10.
- OpenTelemetry semantic conventions for HTTP and RPC.

---

## 30. Seri Progress

Kita sudah menyelesaikan:

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
- Part 011 — Idempotency, Retries, and Exactly-Once Illusions
- Part 012 — Conditional Requests and Optimistic Concurrency
- Part 013 — Caching for Backend Engineers
- Part 014 — Authentication over HTTP
- Part 015 — Authorization and Resource-Level Security
- Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend
- Part 017 — CORS from Backend Enforcement Perspective
- Part 018 — Rate Limiting, Quotas, and Abuse Control
- Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding
- Part 020 — File Upload, Download, Multipart, and Large Payloads
- Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses
- Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers
- Part 023 — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries
- Part 024 — API Design Styles over HTTP

Seri belum selesai. Bagian berikutnya:

**Part 025 — API Versioning and Evolution**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-023.md">⬅️ Part 023 — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-025.md">Part 025 — API Versioning and Evolution ➡️</a>
</div>
