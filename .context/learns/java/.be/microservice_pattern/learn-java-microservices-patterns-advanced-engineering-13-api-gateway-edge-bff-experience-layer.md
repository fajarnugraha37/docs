# Learn Java Microservices Patterns Advanced Engineering
## Part 13 — API Gateway, Edge, BFF, and Experience Layer

**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** `13 / 35`  
**Filename:** `learn-java-microservices-patterns-advanced-engineering-13-api-gateway-edge-bff-experience-layer.md`  
**Scope:** Java 8–25, microservices architecture, API edge, API Gateway, Backend-for-Frontend, experience layer, production design, failure modes, and governance.

---

## 0. Why This Part Exists

Setelah kita membahas service boundary, communication, event-driven architecture, saga, outbox, consistency, data ownership, dan query pattern, sekarang kita masuk ke area yang sering disalahpahami:

> **Bagian edge / gateway / BFF bukan tempat untuk “menaruh semua logic yang tidak tahu harus ditaruh di mana”.**

Dalam microservices, client jarang berbicara langsung ke semua service internal. Biasanya ada lapisan di depan:

- API Gateway
- reverse proxy
- ingress controller
- service mesh ingress
- Backend-for-Frontend
- edge service
- experience API
- API composition service
- identity-aware proxy
- external API facade

Masalahnya, lapisan ini sangat mudah berubah menjadi **god gateway**:

```text
Client
  ↓
API Gateway
  ├── authentication
  ├── authorization
  ├── routing
  ├── rate limiting
  ├── request validation
  ├── aggregation
  ├── transformation
  ├── business rule
  ├── workflow orchestration
  ├── data enrichment
  ├── fallback
  ├── cache
  ├── audit
  ├── reporting shortcut
  └── temporary hack that becomes permanent architecture
```

Pada awalnya terlihat praktis. Satu tempat untuk mengatur semua request. Tetapi lama-lama gateway menjadi:

- bottleneck teknis
- bottleneck deployment
- bottleneck ownership
- bottleneck security
- tempat business logic tersembunyi
- sumber coupling antar domain
- single point of failure
- pusat “temporary workaround”

Part ini membangun mental model yang lebih tajam:

> **Gateway mengelola edge concern. BFF mengelola experience concern. Domain service mengelola business authority.**

Kalau tiga tanggung jawab itu tercampur, microservices perlahan berubah menjadi distributed monolith dengan satu otak raksasa di depan.

---

## 1. Learning Objectives

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan API Gateway, reverse proxy, ingress, BFF, edge service, API composition, dan experience layer.
2. Menentukan logic apa yang layak berada di gateway dan apa yang harus tetap berada di domain service.
3. Mendesain gateway yang aman, observable, resilient, dan tidak menjadi god service.
4. Mendesain BFF untuk kebutuhan frontend tanpa merusak domain ownership.
5. Menentukan kapan response aggregation boleh dilakukan di gateway/BFF dan kapan harus dipindahkan ke query/read model.
6. Mendesain token relay, identity propagation, correlation, rate limiting, dan request shaping secara production-grade.
7. Mengidentifikasi failure mode pada gateway: retry amplification, timeout cascade, partial response, cache leakage, authorization bypass, dan centralized blast radius.
8. Membuat decision matrix untuk memilih antara direct API, API Gateway, BFF, API composition, dan materialized view.
9. Menerapkan pertimbangan Java 8–25 untuk membangun edge service/gateway/BFF.

---

## 2. Core Problem: Client Needs Are Not the Same as Domain Boundaries

Domain service idealnya dibagi berdasarkan business capability dan data ownership. Tetapi client biasanya butuh data berdasarkan **screen, journey, atau interaction**.

Contoh domain service:

```text
Application Service
Profile Service
Document Service
Payment Service
Correspondence Service
Case Service
Audit Service
Notification Service
```

Contoh kebutuhan UI:

```text
Officer Dashboard
Applicant Application Detail Page
Case Review Workspace
Supervisor Approval Inbox
Compliance Inspection Timeline
Public Portal Home
Mobile Notification Center
```

UI tidak peduli bahwa data berasal dari 8 service. UI butuh satu experience yang cepat, konsisten, secure, dan mudah dirender.

Di sinilah muncul tension:

```text
Domain service wants clean ownership.
Frontend wants convenient shape.
Security wants central policy.
Platform wants standard routing.
Operations wants observability.
Architecture wants low coupling.
```

Gateway/BFF/experience layer mencoba menjembatani tension ini. Tetapi jika salah desain, lapisan ini malah menjadi tempat semua coupling berkumpul.

---

## 3. Terminology: Do Not Mix These Concepts

Banyak diskusi microservices kacau karena istilahnya dicampur. Kita luruskan dulu.

### 3.1 Reverse Proxy

Reverse proxy adalah komponen jaringan/aplikasi yang menerima request dari client lalu meneruskannya ke server internal.

Tanggung jawab umum:

- TLS termination
- host/path routing
- header forwarding
- compression
- buffering
- basic load balancing
- connection management

Contoh teknologi:

- Nginx
- HAProxy
- Envoy
- Apache HTTPD
- cloud load balancer

Reverse proxy biasanya **bukan** tempat business logic.

### 3.2 Ingress

Dalam Kubernetes, ingress adalah abstraction untuk expose HTTP/HTTPS route ke service internal.

Tanggung jawab umum:

- routing host/path
- TLS
- ingress class
- integration dengan controller

Ingress bukan otomatis API Gateway. Ia bisa menjadi bagian dari edge stack, tetapi belum tentu punya API management, auth, rate limit, request transformation, quota, developer portal, atau analytics.

### 3.3 API Gateway

API Gateway adalah entry point API yang mengelola cross-cutting concern untuk request client ke backend service.

Tanggung jawab umum:

- routing
- authentication delegation
- token validation/relay
- rate limiting
- quota
- request/response filtering
- header normalization
- API version routing
- monitoring
- controlled aggregation jika memang didesain
- policy enforcement tertentu

Spring Cloud Gateway mendeskripsikan dirinya sebagai library untuk routing ke API dan cross-cutting concerns seperti security, monitoring/metrics, dan resiliency.

### 3.4 API Management Platform

API Management lebih luas dari gateway runtime.

Biasanya mencakup:

- API catalog
- developer portal
- subscription key
- API product
- monetization
- lifecycle management
- analytics
- governance
- gateway policies

Contoh:

- Kong
- Apigee
- Azure API Management
- AWS API Gateway
- Mulesoft
- Tyk

API Gateway adalah runtime path. API Management adalah runtime + governance + developer ecosystem.

### 3.5 Backend-for-Frontend

BFF adalah backend khusus untuk satu jenis frontend atau user experience.

Contoh:

```text
Web Portal BFF
Mobile App BFF
Officer Workspace BFF
Public Portal BFF
Admin Console BFF
```

BFF bertugas membentuk API sesuai kebutuhan frontend tertentu, bukan memaksa semua frontend memakai satu API generik.

Sam Newman memperkenalkan BFF sebagai pendekatan satu backend per user experience, bukan satu general-purpose backend untuk semua client.

### 3.6 Experience Layer

Experience layer adalah lapisan yang membentuk interaction model untuk user/channel tertentu.

Bisa berupa:

- BFF
- API composition service
- UI orchestration service
- frontend-specific read API
- GraphQL facade
- mobile sync API

Experience layer boleh melakukan shape transformation dan composition, tetapi tidak boleh mengambil alih business authority.

### 3.7 API Composition Service

API composition service menggabungkan beberapa backend API untuk menjawab satu query.

Contoh:

```text
GET /officer/worklist
  → Application Service
  → Case Service
  → Profile Service
  → SLA Service
  → Document Service
```

API composition berguna untuk read scenario, tetapi berbahaya jika:

- fan-out terlalu besar
- dependency banyak
- latency tidak terkendali
- filtering/sorting butuh data lintas service
- response harus strongly consistent
- dipakai untuk high-volume dashboard

Untuk query kompleks, materialized view/projection sering lebih baik.

---

## 4. Mental Model: Three Layers of Responsibility

Gunakan model berikut:

```text
┌──────────────────────────────────────────────────────────────┐
│ Client / Frontend / External Consumer                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Edge Layer                                                    │
│ - TLS                                                         │
│ - routing                                                     │
│ - authentication entry                                        │
│ - rate limiting                                               │
│ - WAF / network policy                                        │
│ - request normalization                                       │
│ - coarse observability                                        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Experience Layer / BFF                                        │
│ - client-specific API shape                                   │
│ - UI composition                                              │
│ - partial response strategy                                   │
│ - frontend-specific cache                                     │
│ - UX-friendly error mapping                                   │
│ - channel-specific optimization                               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Domain Services                                               │
│ - business authority                                          │
│ - state transition                                            │
│ - invariant enforcement                                       │
│ - data ownership                                              │
│ - domain audit                                                │
│ - transactional correctness                                   │
└──────────────────────────────────────────────────────────────┘
```

Prinsip utamanya:

```text
Edge protects and routes.
Experience adapts and composes.
Domain decides and owns.
```

Kalau domain decision pindah ke gateway/BFF, ownership rusak.

Kalau frontend-specific concern masuk domain service, domain service menjadi UI-coupled.

Kalau network/security/platform concern masuk semua service tanpa standar, sistem menjadi inconsistent dan mahal dioperasikan.

---

## 5. What Belongs in API Gateway?

### 5.1 Good Gateway Responsibilities

Tanggung jawab yang umumnya cocok di gateway:

1. **Routing**
   - host-based routing
   - path-based routing
   - method-based routing
   - version-based routing

2. **TLS and Protocol Termination**
   - TLS termination
   - HTTP/2 handling
   - HTTP/1.1 downstream compatibility

3. **Authentication Entry Point**
   - redirect ke identity provider
   - token validation awal
   - session cookie handling untuk web edge tertentu

4. **Token Relay / Header Propagation**
   - meneruskan identity context
   - meneruskan correlation id
   - meneruskan trace context

5. **Rate Limiting and Quota**
   - per client
   - per tenant
   - per API product
   - per IP jika public endpoint

6. **Request Normalization**
   - standard headers
   - request size limit
   - content type validation
   - compression negotiation

7. **Coarse-Grained Policy Enforcement**
   - block unauthenticated request
   - block client without subscription
   - block tenant without route permission

8. **Observability Entry Point**
   - request log
   - metrics
   - trace start/continuation
   - access log

9. **API Version Routing**
   - `/v1` → old service
   - `/v2` → new service
   - header-based versioning

10. **Traffic Control**
   - canary routing
   - shadow routing
   - blue/green split
   - kill switch

### 5.2 Dangerous Gateway Responsibilities

Hal berikut harus sangat hati-hati:

1. **Business Rule**

Contoh buruk:

```text
Gateway checks whether application can be approved.
```

Seharusnya Application/Case domain service yang memutuskan.

2. **State Transition**

Contoh buruk:

```text
Gateway updates status from SUBMITTED to APPROVED.
```

Gateway tidak boleh menjadi owner lifecycle.

3. **Deep Authorization Decision**

Gateway boleh melakukan coarse check:

```text
User has token.
User has route-level permission.
```

Tetapi object-level/domain-level authorization harus di service:

```text
Can this officer approve this specific application given assignment, conflict-of-interest, delegation, SLA, and case status?
```

4. **Workflow Orchestration**

Contoh buruk:

```text
Gateway calls Application, then Payment, then Document, then Case, then Notification for business workflow.
```

Itu domain process. Taruh di application service, process manager, saga orchestrator, atau workflow engine yang jelas ownership-nya.

5. **Cross-Service Join with Business Semantics**

Gateway yang melakukan join kompleks biasanya menandakan query/read-model problem.

6. **Permanent Data Transformation for Domain Meaning**

Mapping untuk UX boleh. Tetapi transformasi yang mengubah business meaning harus terjadi di domain boundary.

---

## 6. What Belongs in BFF?

BFF cocok untuk kebutuhan yang spesifik terhadap frontend.

### 6.1 Good BFF Responsibilities

1. **Frontend-Specific API Shape**

Domain API:

```http
GET /applications/{id}
GET /profiles/{id}
GET /documents?applicationId=...
GET /cases?applicationId=...
```

BFF API:

```http
GET /officer/application-review-page/{applicationId}
```

BFF boleh mengembalikan data yang sudah dibentuk sesuai screen:

```json
{
  "application": {...},
  "applicant": {...},
  "documents": [...],
  "caseSummary": {...},
  "availableActions": [...],
  "warnings": [...]
}
```

2. **Partial Response Strategy**

Jika document preview gagal, halaman review tetap bisa tampil dengan warning.

```json
{
  "application": {...},
  "documents": {
    "status": "UNAVAILABLE",
    "message": "Document preview is temporarily unavailable"
  }
}
```

3. **Client-Specific Caching**

Mobile BFF mungkin cache reference data lebih agresif.

Web officer BFF mungkin cache dashboard count sebentar.

4. **UX-Friendly Error Mapping**

Domain service bisa mengembalikan error teknis/domain detail. BFF menerjemahkan menjadi UX state.

```text
DOMAIN_ERROR: APPLICATION_ALREADY_ASSIGNED
→ UI message: “This application has already been assigned to another officer.”
```

5. **Channel-Specific Optimization**

Mobile:

- payload kecil
- image/document lazy loading
- offline sync
- compressed response

Web:

- richer payload
- more navigation metadata
- preloaded lookup values

6. **Frontend Release Decoupling**

BFF bisa membantu frontend berubah tanpa memaksa domain service menyesuaikan setiap UI change.

### 6.2 Dangerous BFF Responsibilities

1. **Business Authority**

BFF tidak boleh menjadi sumber kebenaran rule approval.

2. **Long-Running Workflow Owner**

BFF tidak boleh menyimpan process state penting.

3. **Data Ownership**

BFF boleh punya cache/read model untuk experience, tetapi bukan authoritative data owner.

4. **Authorization Source of Truth**

BFF boleh menampilkan `availableActions`, tetapi domain service tetap harus enforce saat command dijalankan.

5. **Generic Backend for Everything**

Kalau satu BFF dipakai semua channel dan semua domain, ia berubah menjadi monolith baru.

---

## 7. Gateway vs BFF vs API Composition vs Materialized View

Gunakan decision matrix berikut.

| Need | Best Fit | Avoid |
|---|---|---|
| Route external API to internal service | API Gateway | BFF with routing hacks |
| Validate token and apply coarse route policy | API Gateway | Every service doing inconsistent auth parsing |
| Tailor response for one frontend screen | BFF | Domain service polluted by UI concerns |
| Aggregate 2–4 low-latency APIs for one UI | BFF/API Composition | Gateway with hidden business logic |
| Aggregate 10+ dependencies for dashboard | Materialized View / Projection | Runtime fan-out on every request |
| Cross-service filtering/sorting/pagination | Materialized View | API composition with in-memory join |
| Perform business state transition | Domain Service | Gateway/BFF |
| Orchestrate long-running business process | Process Manager / Saga Orchestrator / Workflow Engine | Gateway/BFF |
| Enforce object-level domain authorization | Domain Service | Gateway-only authorization |
| Apply per-client rate limit | API Gateway | Domain service duplicated policy |
| Provide mobile-specific payload | Mobile BFF | One generic backend API |
| Public API product lifecycle | API Management | Plain ingress only |

---

## 8. Request Flow Patterns

### 8.1 Simple Gateway Routing

```text
Client
  → API Gateway
      → Application Service
```

Best for:

- simple CRUD/resource API
- one backend service owns response
- no aggregation needed

Risk:

- gateway starts adding transformations
- path mapping hides bad domain API

### 8.2 Gateway + BFF

```text
Web Client
  → API Gateway
      → Web BFF
          → Application Service
          → Profile Service
          → Document Service
```

Best for:

- frontend-specific API
- multiple backend calls
- partial response
- UX-specific caching

Risk:

- BFF becomes mini-monolith
- BFF makes business decisions
- backend fan-out grows uncontrolled

### 8.3 Gateway + Materialized View

```text
Client
  → API Gateway
      → Worklist Query Service
          → Worklist Projection DB

Domain Events
  → Projection Builder
      → Worklist Projection DB
```

Best for:

- dashboard
- worklist
- report-like listing
- filtering/sorting/pagination across domains
- high read volume

Risk:

- stale data
- projection drift
- replay complexity
- authorization leakage if projection is wrong

### 8.4 Gateway + Command Service

```text
Client
  → API Gateway
      → Application Command Service
          → local transaction
          → outbox event
```

Best for:

- state changes
- domain decision
- invariant enforcement

Risk:

- client expects immediate cross-service completion
- command service does synchronous chain to many services

### 8.5 External API Facade

```text
External Partner
  → API Gateway / API Management
      → External API Facade
          → Internal Services
```

Best for:

- partner-facing stable contract
- internal API hiding
- external lifecycle management
- partner-specific throttling

Risk:

- facade becomes business duplicate
- external contract diverges too far from domain capability

---

## 9. API Gateway Responsibility Boundaries

### 9.1 Routing

Gateway route should be explicit and reviewable.

Example route ownership table:

| External Route | Internal Target | Owner | Auth Policy | Rate Limit | Notes |
|---|---|---|---|---|---|
| `/api/applications/**` | Application Service | Application Team | Officer/Applicant | 100 rps/tenant | Resource API |
| `/api/officer/worklist/**` | Officer BFF | Experience Team | Officer | 50 rps/user | UI API |
| `/api/public/applications/**` | Public Portal BFF | Public Team | Applicant | 20 rps/user | Internet-facing |
| `/api/admin/**` | Admin BFF | Platform/Admin Team | Admin | 10 rps/user | Sensitive |

Do not allow route definitions to become undocumented tribal knowledge.

### 9.2 Header Normalization

Gateway commonly ensures standard headers:

```http
X-Request-Id: req-...
X-Correlation-Id: corr-...
traceparent: 00-...
X-Forwarded-For: ...
X-Forwarded-Proto: https
X-Tenant-Id: ...
```

But be careful:

- Do not trust client-provided internal headers blindly.
- Strip spoofable headers at the edge.
- Recreate trusted headers after authentication.
- Mark whether a header is user-provided or gateway-attested.

A safe principle:

```text
External client headers are claims.
Gateway-attested headers are context.
Domain service must know the difference.
```

### 9.3 Authentication Delegation

Gateway can validate:

- token signature
- token issuer
- token audience
- token expiry
- token format
- session cookie

But service should still validate if needed, especially for high-security/internal zero-trust systems.

Common models:

| Model | Description | Risk |
|---|---|---|
| Gateway-only validation | Gateway validates, downstream trusts headers | Header spoofing if network not isolated |
| Token relay | Gateway forwards original JWT/token | Each service must validate/parse |
| Token exchange | Gateway exchanges external token for internal token | More secure but more infrastructure |
| Session-to-token bridge | Gateway converts web session to token context | Must handle expiry/logout carefully |
| mTLS service identity | Gateway and services identify each other | Operational complexity |

### 9.4 Authorization Boundary

Gateway authorization should usually be **coarse**.

Example gateway policy:

```text
Officer can access /officer/** routes.
Applicant can access /public/applicant/** routes.
Admin can access /admin/** routes.
```

Domain service policy:

```text
Officer can approve Application A only if:
- officer belongs to assigned unit
- application is in REVIEW_PENDING
- officer has approval role for category
- officer is not the original submitter
- case is not locked
- delegation is active
- approval amount is within threshold
```

Never rely only on gateway for domain authorization.

### 9.5 Rate Limiting

Rate limit can be applied by:

- IP
- user
- tenant
- client application
- API key
- route
- method
- backend capacity class

Example:

```text
Public search API:
- 30 req/min per anonymous IP
- 120 req/min per authenticated applicant
- 1000 req/min per partner client with contract

Officer worklist API:
- 60 req/min per officer
- 300 req/min per tenant
- backend concurrency limit 50
```

Rate limiting must consider backend capacity, not just fairness.

### 9.6 Request Size and Payload Protection

Gateway should protect backend services from abusive payloads:

- max body size
- max header size
- allowed content type
- multipart constraints
- upload route separation
- slowloris protection
- request timeout

Large upload/download should often bypass normal BFF path and use object storage pre-signed URL or dedicated document service path.

---

## 10. Backend-for-Frontend Design

### 10.1 One BFF per Frontend Type, Not per Screen by Default

Bad decomposition:

```text
LoginPageBff
DashboardPageBff
ApplicationDetailPageBff
DocumentPageBff
ApprovalPageBff
```

This creates too many tiny services.

Better:

```text
OfficerPortalBff
ApplicantPortalBff
AdminConsoleBff
MobileAppBff
ExternalPartnerBff
```

Inside a BFF, you can have modules/use cases per screen.

### 10.2 BFF API Should Reflect Experience, Not Domain Storage

Domain API:

```http
GET /applications/{id}
GET /applications/{id}/state
GET /applications/{id}/available-actions
GET /profiles/{id}
GET /documents?applicationId={id}
```

Officer BFF API:

```http
GET /officer/review-workspace/{applicationId}
```

Response:

```json
{
  "page": "APPLICATION_REVIEW_WORKSPACE",
  "application": {
    "id": "APP-001",
    "status": "REVIEW_PENDING",
    "submittedAt": "2026-06-19T10:15:00+07:00"
  },
  "applicant": {
    "displayName": "Jane Doe",
    "identifierMasked": "S****123A"
  },
  "documents": {
    "items": [],
    "availability": "AVAILABLE"
  },
  "actions": [
    { "code": "APPROVE", "enabled": true },
    { "code": "REQUEST_INFO", "enabled": true },
    { "code": "REJECT", "enabled": false, "reason": "Missing mandatory review note" }
  ],
  "warnings": []
}
```

Important:

- `actions` is useful for UI rendering.
- Domain service must still validate command when user clicks `APPROVE`.
- BFF-provided available actions are not security authority.

### 10.3 BFF Should Prefer Read Composition, Not Command Orchestration

BFF may compose reads:

```text
Load page data.
Load reference data.
Load notification count.
Load document metadata.
```

But command should go to authoritative domain service:

```http
POST /applications/{id}/approve
```

If command requires multiple domain steps, use:

- application service orchestration
- saga orchestrator
- process manager
- workflow engine

Not BFF.

### 10.4 BFF Partial Response Strategy

In a page, not all parts have equal criticality.

Example:

| Component | Critical? | Failure Behavior |
|---|---:|---|
| Application core data | Yes | fail page |
| Applicant name | Yes | fail page or restricted fallback |
| Document preview | No | show unavailable panel |
| Notification count | No | hide badge |
| Audit timeline | Maybe | show delayed warning |
| Available actions | Yes | disable actions if uncertain |

BFF response should encode partial availability explicitly:

```json
{
  "application": { "status": "AVAILABLE", "data": {...} },
  "documents": { "status": "TEMPORARILY_UNAVAILABLE" },
  "notifications": { "status": "SKIPPED_DUE_TO_TIMEOUT" }
}
```

Avoid ambiguous partial response where missing fields look like empty data.

```json
{
  "documents": []
}
```

Does this mean no documents, or document service failed?

Use explicit availability.

### 10.5 BFF Timeout Budget

A page load must have a total deadline.

Example:

```text
Officer review page total budget: 1500 ms

Gateway overhead:              50 ms
BFF processing:                50 ms
Application Service:          300 ms critical
Profile Service:              250 ms critical
Document Metadata Service:    300 ms optional
Audit Timeline Service:       400 ms optional
Notification Service:         100 ms optional
Safety margin:                200 ms
```

BFF should not let every downstream call use its own arbitrary timeout.

Bad:

```text
BFF has no total deadline.
Each downstream call timeout = 30 seconds.
Frontend waits forever.
Threads pile up.
Gateway times out first.
Downstream keeps working uselessly.
```

Good:

```text
Request has deadline.
Each dependency gets allocated budget.
Optional dependencies can be skipped.
Critical dependency failure fails fast.
```

### 10.6 BFF Aggregation Fan-Out Limit

Fan-out increases tail latency and failure probability.

If one page calls 8 services, the chance that all succeed is lower than any individual service availability.

Example:

```text
Each dependency availability = 99.9%
8 independent dependencies:
0.999^8 = 99.2%
```

That ignores latency, retry, and correlated failure.

Heuristic:

```text
1–3 calls: often acceptable
4–6 calls: requires careful timeout/partial response
7+ calls: consider projection/materialized view
```

Not a universal rule, but a useful smell detector.

---

## 11. Gateway Aggregation: When It Is Acceptable

Gateway aggregation means the gateway itself calls multiple backend services and returns one response.

This can reduce client round-trips, especially over high-latency networks. Azure Architecture Center describes gateway aggregation as a pattern where the gateway aggregates multiple backend requests into one client request.

Acceptable cases:

1. **Simple, shallow aggregation**

```text
Product details + price + inventory summary
```

2. **No business decision**

Gateway only combines data, not deciding domain outcome.

3. **Small fan-out**

Two or three dependencies.

4. **Explicit partial response**

Client understands unavailable components.

5. **Owned by experience/platform team**

Not random logic owned by nobody.

6. **Timeout and fallback are designed**

Not accidental defaults.

Avoid gateway aggregation when:

- aggregation requires complex filtering/sorting
- response needs cross-domain consistency
- logic changes frequently with business rules
- dependencies exceed practical fan-out
- gateway team does not own domain semantics
- aggregation is used to hide bad service boundaries

Often, BFF is a better place than generic gateway for aggregation because BFF has clearer client-experience ownership.

---

## 12. GraphQL as Experience Layer

GraphQL is sometimes used as an experience API across microservices.

Benefits:

- client can request exact shape
- reduces over-fetching/under-fetching
- schema provides typed contract
- useful for complex UI composition

Risks:

- N+1 backend calls
- hidden fan-out
- authorization complexity
- caching difficulty
- schema ownership ambiguity
- query cost explosion
- exposing internal domain graph accidentally

GraphQL can be a good BFF technology when:

- schema is curated for experience, not raw database
- resolver cost is controlled
- authorization is enforced per field/object
- query depth/complexity is limited
- backend calls are batched
- observability tracks resolver-level latency

GraphQL becomes dangerous when treated as:

```text
“Let frontend join all microservices dynamically.”
```

That is just distributed database access with a nicer syntax.

---

## 13. Security Design at Gateway and BFF

### 13.1 Trust Boundary

At the edge, assume everything from outside is hostile:

```text
Client input is untrusted.
Headers are spoofable.
Tokens may be expired, replayed, or intended for another audience.
Payload may be malicious.
Rate may be abusive.
```

Gateway should sanitize and attest context.

### 13.2 Token Validation

Validate:

- issuer
- audience
- signature
- expiry
- not-before
- algorithm
- key rotation/JWKS refresh
- required claims

Never accept tokens with wrong audience just because signature is valid.

### 13.3 Token Relay

Token relay means forwarding the original token downstream.

Pros:

- downstream service can enforce user-level authorization
- audit can include original user
- simpler identity propagation

Cons:

- every service needs token validation/parsing
- token may contain too many claims
- internal services become coupled to external identity format
- risk of token leakage in logs

### 13.4 Token Exchange

Token exchange means converting external token into internal token.

Example:

```text
External OIDC token
  → Gateway validates
  → Gateway exchanges to internal service token
  → Downstream receives token with internal audience and scoped claims
```

Pros:

- internal audience restriction
- smaller internal token
- separates external identity from internal trust model

Cons:

- more complex identity infrastructure
- token exchange failure mode
- operational overhead

### 13.5 Header-Based Identity Propagation

Bad if naive:

```http
X-User-Id: alice
X-Roles: admin
```

If clients can send these headers, privilege escalation becomes trivial.

Safer:

- strip external identity headers at edge
- validate token
- create internal signed context or internal token
- use mTLS/network policy to ensure only gateway can call services if relying on gateway-attested headers

### 13.6 Object-Level Authorization

Gateway cannot know every domain object rule.

Example:

```text
Route-level access:
Officer can call /applications/{id}/approve.

Object-level domain access:
Officer can approve this specific application only if assigned, not conflicted, role is sufficient, status is valid, and SLA window is open.
```

Domain service must enforce object-level authorization.

### 13.7 BFF and CSRF

For browser-based BFF with cookie sessions:

- SameSite cookie strategy
- CSRF token if needed
- secure cookie
- httpOnly cookie
- CORS restriction
- origin validation

For token-based SPA:

- avoid storing long-lived tokens in local storage
- consider BFF session pattern
- handle silent refresh safely

### 13.8 CORS

CORS is browser policy, not backend security by itself.

Gateway may configure CORS, but do not treat CORS as authorization.

---

## 14. Observability at Edge and BFF

Gateway/BFF is the best place to observe client-facing behavior.

Track:

### 14.1 Gateway Metrics

- requests per route
- latency per route
- 2xx/3xx/4xx/5xx count
- auth failure count
- rate limit rejection count
- upstream timeout count
- upstream connection failure count
- request/response size
- retry count if gateway retries
- circuit breaker state if used

### 14.2 BFF Metrics

- page API latency
- downstream call latency
- downstream partial failure
- component availability
- fan-out count per request
- cache hit/miss
- degraded response count
- user-visible error count

### 14.3 Correlation and Trace

Every edge request should have:

```text
request_id
correlation_id
trace_id
span_id
user/subject id where allowed
tenant id where allowed
client id
route id
```

But avoid logging sensitive claims.

### 14.4 Business/Experience Metrics

BFF can emit UX-level signals:

- dashboard load success
- review page degraded
- submit button available/unavailable
- document preview unavailable
- command rejected by domain service

These are not domain audit events. They are experience observability events.

### 14.5 High-Cardinality Warning

Do not put raw user id, application id, document id, or token claims as high-cardinality metric labels.

Use logs/traces for detailed IDs, metrics for aggregate dimensions.

---

## 15. Resilience and Failure Modes

### 15.1 Gateway as Single Point of Failure

If every request passes through gateway, gateway outage becomes platform outage.

Mitigation:

- horizontal scaling
- health checks
- safe config rollout
- config validation
- canary gateway config
- fallback route rules
- separate internet/intranet gateway if needed
- no heavy business computation inside gateway

### 15.2 Retry Amplification

Danger:

```text
Client retries 3x
Gateway retries 3x
BFF retries 3x
Service retries 3x
Database driver retries 3x

Total possible amplification = 3^5 = 243 attempts
```

Gateway retry must be conservative.

Safe retry only for:

- idempotent methods
- transient network error
- bounded retry budget
- jitter
- deadline-aware execution

Avoid gateway retry for:

- non-idempotent POST without idempotency key
- long-running operation
- already overloaded backend
- unknown outcome side effect

### 15.3 Timeout Mismatch

Bad configuration:

```text
Client timeout: 5s
Gateway timeout: 60s
BFF downstream timeout: 30s
Service DB timeout: 120s
```

Client already left, but backend continues.

Better:

```text
Client timeout: 5s
Gateway timeout: 4.8s
BFF total deadline: 4.5s
Critical backend timeout: 1s each
Optional backend timeout: 300ms each
DB statement timeout: below service budget
```

### 15.4 Circuit Breaker Placement

Circuit breaker can exist at:

- gateway to backend route
- BFF to backend dependency
- service-to-service client

But duplicate breakers can make behavior hard to reason about.

Define owner:

```text
Gateway breaker protects platform route.
BFF breaker protects user experience from optional dependency.
Domain service breaker protects domain operation from downstream dependency.
```

### 15.5 Partial Response vs Fail Fast

For read experience:

- optional component failure → partial response
- critical component failure → fail page

For command:

- uncertain authorization → deny or fail safely
- uncertain state transition → do not fake success
- unknown side effect → expose pending/unknown status, reconcile

### 15.6 Cache Leakage

BFF/gateway cache can leak data if cache key ignores:

- user
- tenant
- role
- locale
- authorization scope
- query parameters

Bad cache key:

```text
/application-review-page/APP-001
```

Safer cache key:

```text
tenant=T1:user=U1:roles=officer:route=/application-review-page/APP-001:locale=en-SG
```

Even safer: do not cache sensitive personalized data unless proven safe.

### 15.7 Gateway Config Error

A wrong gateway config can expose admin API publicly or route traffic to wrong environment.

Mitigation:

- route config review
- policy-as-code
- automated tests for gateway routes
- environment-specific route validation
- deny-by-default
- sensitive route explicit allowlist
- config canary

---

## 16. Java 8–25 Considerations

### 16.1 Java 8

Java 8 is common in legacy enterprise systems.

Implications:

- no standard JDK HttpClient
- use Apache HttpClient/OkHttp/RestTemplate-era clients
- CompletableFuture exists but less ergonomic
- no records/sealed classes/pattern matching
- limited container ergonomics compared with newer JDKs
- be careful with thread pool sizing

Gateway/BFF in Java 8 is possible but less ideal for modern high-concurrency edge services.

### 16.2 Java 11

Java 11 introduced standard `java.net.http.HttpClient`.

Implications:

- better baseline for HTTP client calls
- improved container awareness compared with Java 8
- LTS migration target for many enterprises
- still no virtual threads

### 16.3 Java 17

Java 17 is a strong modern LTS baseline.

Implications:

- records for DTO-like response models
- sealed classes for error/result modeling
- better GC/runtime behavior
- Spring Boot 3 baseline requires Java 17
- modern framework ecosystem support

BFF code can become cleaner:

```java
public record PageSection<T>(
    SectionStatus status,
    T data,
    String message
) {}

public enum SectionStatus {
    AVAILABLE,
    TEMPORARILY_UNAVAILABLE,
    FORBIDDEN,
    SKIPPED_DUE_TO_TIMEOUT
}
```

### 16.4 Java 21

Java 21 brings virtual threads as a stable feature.

Implications for BFF:

- blocking style becomes more scalable for I/O-bound aggregation
- simpler code than reactive chains for many teams
- still need timeouts, bulkheads, connection pools, and backpressure
- virtual threads do not make downstream services faster

Example mental model:

```text
Virtual threads reduce cost of waiting.
They do not remove the need to bound waiting.
```

BFF aggregation with virtual threads can be clean:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<ApplicationDto> app = executor.submit(() -> applicationClient.get(id));
    Future<ProfileDto> profile = executor.submit(() -> profileClient.get(applicantId));
    Future<DocumentSummary> docs = executor.submit(() -> documentClient.list(id));

    return new ReviewPage(
        app.get(300, TimeUnit.MILLISECONDS),
        profile.get(300, TimeUnit.MILLISECONDS),
        sectionFromFuture(docs, 250)
    );
}
```

But production code needs:

- total deadline
- cancellation
- fallback
- context propagation
- connection pool limits
- metrics

### 16.5 Java 25

Java 25 is the latest long-term horizon in this series. Use it as forward-looking runtime planning, not assumption for all enterprise deployments.

Implications:

- stronger modern language/runtime baseline
- better opportunity to standardize on virtual-thread-friendly design
- modern GC and JVM ergonomics
- ecosystem compatibility must be verified per framework/vendor

For microservices architecture, Java version matters less than correctness boundaries, but it affects implementation trade-offs:

| Concern | Java 8 | Java 11 | Java 17 | Java 21/25 |
|---|---|---|---|---|
| DTO modeling | classes | classes | records | records |
| concurrency style | thread pools | thread pools/CF | thread pools/CF | virtual threads possible |
| HTTP client | external libs | JDK HttpClient | JDK/external | JDK/external + VT-friendly blocking |
| container ergonomics | weaker | better | strong | strong |
| framework compatibility | legacy | moderate | modern baseline | verify latest |

---

## 17. Framework and Technology Positioning

### 17.1 Spring Cloud Gateway

Spring Cloud Gateway is suitable when:

- team is already in Spring ecosystem
- dynamic routing/filtering is needed
- route filters, predicates, metrics, security integration are useful
- gateway is deployed as a Java service

Be careful:

- Gateway built on reactive stack may require different operational understanding
- do not implement heavy business logic in filters
- avoid blocking calls in reactive gateway path unless using correct MVC/server flavor and thread model

### 17.2 Spring Boot BFF

Spring Boot is often a good BFF choice:

- easy HTTP clients
- security integration
- observability integration
- JSON handling
- validation
- resilience libraries
- virtual-thread-friendly blocking style in modern versions

BFF is application code, so Spring Boot is often more appropriate than a generic gateway product when client-specific behavior is needed.

### 17.3 MicroProfile / Jakarta EE

MicroProfile provides relevant specifications:

- Config
- Fault Tolerance
- Health
- JWT Authentication
- OpenAPI
- Telemetry
- Rest Client

Good fit when:

- enterprise Jakarta runtime is standard
- portability across vendors matters
- JAX-RS/MicroProfile is already used
- service wants spec-based programming model

### 17.4 Quarkus

Quarkus can be suitable for:

- fast startup
- lower memory footprint
- Kubernetes-native deployment
- reactive or imperative endpoints
- native image scenarios

Use for BFF/edge service when operational fit is strong, but still apply the same boundary rules.

### 17.5 Nginx / Envoy / HAProxy

Good for:

- high-performance proxying
- TLS
- routing
- load balancing
- protocol handling
- platform-level ingress

Less appropriate for:

- complex client-specific composition
- domain-aware transformation
- workflow behavior

### 17.6 API Management Products

Use when you need:

- external API lifecycle
- API keys/subscriptions
- developer portal
- partner onboarding
- quota management
- API analytics
- monetization or contract-based access

Do not confuse API management with domain architecture.

---

## 18. Design Pattern: Edge Security + Domain Enforcement

A production-grade request should pass through multiple enforcement layers.

```text
Client
  ↓
Gateway
  - authenticates token
  - validates route access
  - applies rate limit
  - strips spoofed headers
  - attaches correlation/trace
  ↓
BFF
  - shapes UX request
  - fetches page data
  - maps UX errors
  ↓
Domain Service
  - validates command
  - checks object-level permission
  - enforces invariant
  - commits transaction
  - publishes outbox event
```

Example command:

```http
POST /officer/applications/APP-001/approve
```

BFF forwards to domain command:

```http
POST /applications/APP-001/approval
```

Domain service checks:

```text
Is application in APPROVABLE state?
Is officer assigned?
Does officer have required role?
Is application locked?
Are mandatory documents verified?
Is there conflict of interest?
Is approval threshold within officer delegation?
```

Gateway/BFF may help route, authenticate, and shape response. They must not become the authority for those checks.

---

## 19. Design Pattern: Experience API with Explicit Partial Availability

For complex read pages, return component-level status.

```json
{
  "pageStatus": "DEGRADED",
  "application": {
    "status": "AVAILABLE",
    "data": {
      "id": "APP-001",
      "state": "REVIEW_PENDING"
    }
  },
  "applicant": {
    "status": "AVAILABLE",
    "data": {
      "name": "Jane Doe"
    }
  },
  "documents": {
    "status": "TEMPORARILY_UNAVAILABLE",
    "message": "Document metadata could not be loaded. Try again later."
  },
  "auditTimeline": {
    "status": "SKIPPED_DUE_TO_TIMEOUT"
  },
  "availableActions": {
    "status": "AVAILABLE",
    "data": [
      { "action": "APPROVE", "enabled": true },
      { "action": "REQUEST_INFO", "enabled": true }
    ]
  }
}
```

Rules:

1. Missing data and empty data must be distinguishable.
2. Unavailable optional section should not corrupt main page.
3. Unavailable authorization/action section should fail safe.
4. UI should render degraded states intentionally.
5. Metrics should count degraded responses.

---

## 20. Design Pattern: Route Policy as Code

Gateway policy should be versioned and testable.

Example conceptual policy:

```yaml
routes:
  - id: officer-application-api
    match:
      path: /api/officer/applications/**
    target: officer-bff
    auth:
      required: true
      roles: [OFFICER]
    rateLimit:
      key: user
      limit: 120
      window: 60s
    headers:
      strip:
        - X-User-Id
        - X-Roles
        - X-Tenant-Id
      addTrustedContext: true
    timeout: 5s
```

Tests should verify:

- unauthenticated request rejected
- wrong role rejected
- spoofed headers stripped
- route points to correct service
- admin route is not public
- CORS only allows expected origins
- rate limit policy exists

---

## 21. Design Pattern: BFF Module Structure in Java

A BFF should not become a messy controller pile.

Example package structure:

```text
com.example.officerbff
  ├── OfficerBffApplication.java
  ├── edge
  │   ├── controller
  │   ├── filter
  │   └── error
  ├── experience
  │   ├── applicationreview
  │   │   ├── ApplicationReviewController.java
  │   │   ├── ApplicationReviewAssembler.java
  │   │   ├── ApplicationReviewService.java
  │   │   └── dto
  │   ├── worklist
  │   └── dashboard
  ├── client
  │   ├── application
  │   ├── profile
  │   ├── document
  │   └── audit
  ├── security
  ├── observability
  └── resilience
```

Rules:

- Controllers should be thin.
- Experience service coordinates read composition.
- Client adapters isolate downstream API contracts.
- DTOs are BFF-specific.
- Domain model should not be copied as shared library.
- Business state transition still belongs downstream.

---

## 22. Example: Officer Application Review BFF

### 22.1 Scenario

Officer opens application review page.

Required sections:

- application summary
- applicant profile
- document checklist
- risk flags
- audit timeline
- available actions

### 22.2 Dependency Criticality

| Section | Dependency | Criticality | Timeout | Fallback |
|---|---|---:|---:|---|
| application summary | Application Service | Critical | 300ms | fail page |
| applicant profile | Profile Service | Critical | 300ms | fail page or restricted view |
| document checklist | Document Service | Important | 400ms | degraded section |
| risk flags | Screening Service | Important | 500ms | degraded + disable approval |
| audit timeline | Audit Service | Optional | 300ms | hide timeline |
| available actions | Application Service | Critical | 300ms | disable commands |

### 22.3 Important Detail: Fallback Must Be Safe

If risk flags fail, should approval still be enabled?

Probably no.

```text
Risk flags unavailable
→ page can render
→ approval action disabled
→ user sees “Risk check temporarily unavailable”
```

Do not fallback to “no risk”.

Wrong:

```json
"riskFlags": []
```

Correct:

```json
"riskFlags": {
  "status": "TEMPORARILY_UNAVAILABLE",
  "approvalAllowed": false
}
```

### 22.4 Command Flow

When officer clicks approve:

```text
Client
  → Officer BFF
      → Application Service approve command
          → validates state
          → validates assignment
          → validates risk status
          → commits approval
          → emits ApplicationApproved event
```

BFF does not approve. BFF forwards command and shapes result.

---

## 23. Anti-Patterns

### 23.1 God Gateway

Symptoms:

- gateway owns business logic
- gateway calls many services for command workflows
- gateway has domain-specific code for every team
- gateway release blocks domain releases
- gateway team becomes bottleneck

Fix:

- move domain rules to domain services
- move experience logic to BFF
- move query-heavy aggregation to projection/read model
- enforce route/filter ownership

### 23.2 One BFF for All Clients

Symptoms:

- mobile/web/admin/external all use same BFF
- API becomes full of optional fields
- payload bloats
- changes for one frontend break another

Fix:

- split by user experience/channel
- define ownership
- avoid per-screen micro-BFF explosion

### 23.3 Gateway as Workflow Engine

Symptoms:

```text
POST /submit
Gateway calls:
1. Application Service
2. Document Service
3. Payment Service
4. Notification Service
5. Case Service
```

Fix:

- domain application service
- saga orchestrator
- process manager
- workflow engine

### 23.4 Gateway-Only Authorization

Symptoms:

- service trusts all gateway-passed requests
- object-level permission absent in domain service
- internal call bypass can mutate data

Fix:

- service-level enforcement
- token audience
- mTLS/internal auth
- defense in depth

### 23.5 Hidden Fan-Out

Symptoms:

- one API looks simple but calls 12 services
- latency unstable
- incident debugging hard
- dependency graph unknown

Fix:

- fan-out metrics
- dependency map
- materialized view
- split page into lazy sections

### 23.6 Cache as Authorization Bypass

Symptoms:

- personalized response cached only by URL
- users see other users’ data
- tenant leakage

Fix:

- authorization-aware cache key
- avoid caching sensitive pages
- explicit cache policy review

### 23.7 Edge Transformation as Permanent Domain Mapping

Symptoms:

- gateway maps domain codes into business meanings
- multiple clients rely on gateway-specific semantics
- domain service contract becomes unclear

Fix:

- domain service owns semantic mapping
- BFF owns UX labels only

### 23.8 Generic Proxy Service

Symptoms:

- BFF/gateway simply forwards arbitrary downstream URLs
- frontend chooses internal service paths
- internal topology leaks to client

Fix:

- expose intentional APIs
- hide service topology
- define stable experience contract

---

## 24. Testing Strategy

### 24.1 Gateway Tests

Test:

- route matching
- auth enforcement
- header stripping
- CORS
- rate limiting
- timeout behavior
- route not found behavior
- admin route exposure
- config validation

### 24.2 BFF Unit Tests

Test:

- response assembly
- partial response mapping
- error mapping
- fallback safety
- timeout behavior
- action disabling when dependency uncertain

### 24.3 Contract Tests

BFF is consumer of domain APIs.

Test:

- downstream contract compatibility
- DTO evolution
- error contract
- enum handling
- missing/extra fields

### 24.4 Integration Tests

Test:

- BFF calls stubbed downstream services
- dependency failure
- slow dependency
- partial response
- auth context propagation

### 24.5 Security Tests

Test:

- spoofed header stripped
- invalid token rejected
- wrong audience rejected
- expired token rejected
- object-level authorization enforced downstream
- CORS restricted
- CSRF for cookie-based BFF

### 24.6 Load Tests

Test:

- BFF fan-out under load
- connection pool exhaustion
- gateway route throughput
- rate limit effectiveness
- optional dependency degradation
- retry amplification

---

## 25. Production Readiness Checklist

### 25.1 API Gateway Checklist

- [ ] Routes are documented and owned.
- [ ] Sensitive routes are deny-by-default.
- [ ] Authentication policy is explicit.
- [ ] Route-level authorization is explicit.
- [ ] Spoofable headers are stripped.
- [ ] Trusted identity context is generated safely.
- [ ] Rate limit is defined per critical route.
- [ ] Request size limit exists.
- [ ] Timeout is configured per route.
- [ ] Retry policy is conservative and idempotency-aware.
- [ ] Access logs are enabled with sensitive data redaction.
- [ ] Metrics exist per route.
- [ ] Trace propagation works.
- [ ] Gateway config has tests.
- [ ] Gateway config rollout is safe.
- [ ] Fallback behavior is explicit.
- [ ] Admin/internal routes are not exposed externally.

### 25.2 BFF Checklist

- [ ] BFF has clear frontend/channel ownership.
- [ ] BFF does not own domain state transition.
- [ ] BFF response is tailored to experience.
- [ ] BFF partial response is explicit.
- [ ] Critical vs optional dependencies are documented.
- [ ] Timeout budget exists per endpoint.
- [ ] Fan-out count is monitored.
- [ ] Downstream contracts are tested.
- [ ] Error mapping is consistent.
- [ ] Authorization-sensitive fallback fails safe.
- [ ] Cache keys include tenant/user/permission where required.
- [ ] BFF emits experience-level metrics.
- [ ] BFF has dependency failure tests.
- [ ] BFF has load tests for fan-out.

### 25.3 Domain Service Checklist

- [ ] Domain service enforces object-level authorization.
- [ ] Domain service enforces invariants.
- [ ] Domain service does not trust UI-provided action availability.
- [ ] Domain service validates command idempotency.
- [ ] Domain service emits domain audit/event where required.
- [ ] Domain service can be called safely from multiple clients/BFFs.

---

## 26. Architecture Review Questions

Use these in design review.

### Gateway

1. What routes exist, and who owns each route?
2. What exactly is authenticated at gateway?
3. What authorization decision is made at gateway vs domain service?
4. Which headers are stripped and which are generated?
5. What is the timeout per route?
6. Does gateway retry? If yes, only for which methods/errors?
7. What happens if gateway config is wrong?
8. How are gateway policies tested?
9. Is gateway becoming a place for business logic?
10. What is gateway blast radius?

### BFF

1. Which frontend/channel does this BFF serve?
2. What downstream services does each endpoint call?
3. What is critical vs optional?
4. What is the total latency budget?
5. What happens when each dependency fails?
6. Are missing data and unavailable data distinguishable?
7. Does BFF make domain decisions?
8. Does BFF cache sensitive data?
9. How is object-level authorization enforced?
10. Is this better solved by projection/materialized view?

### Experience Layer

1. Is the API shaped around user journey or around internal service topology?
2. Are actions displayed by UI revalidated by command service?
3. Can different frontends evolve independently?
4. Does the experience API leak internal domain model?
5. Is the read model freshness acceptable?

---

## 27. Decision Framework

When designing an endpoint, ask:

### Step 1 — Is it command or query?

```text
Command → domain service / application service / workflow owner
Query → BFF/API composition/materialized view
```

### Step 2 — Is the response client-specific?

```text
Yes → BFF / experience API
No → domain API may be enough
```

### Step 3 — How many dependencies?

```text
0–1 → direct route
2–4 → BFF composition may be okay
5+ → consider projection/materialized view
```

### Step 4 — Does it need filtering/sorting/pagination across services?

```text
Yes → projection/materialized view/search index
No → composition may be okay
```

### Step 5 — Does it require strong consistency?

```text
Yes → single authority or command-side query
No → projection/eventual read model possible
```

### Step 6 — Is it public/partner-facing?

```text
Yes → API Gateway/API Management + stable facade
No → internal gateway/BFF may be enough
```

### Step 7 — Is authorization object-level?

```text
Yes → domain service must enforce
Gateway can only pre-filter
```

---

## 28. Common Design Trade-Offs

### 28.1 Gateway Simplicity vs Feature Richness

More gateway features can reduce duplicated code, but increase central coupling.

Good centralization:

- TLS
- route auth
- rate limit
- observability

Bad centralization:

- domain workflows
- business rules
- data joins
- per-domain hacks

### 28.2 BFF Convenience vs Duplication

Multiple BFFs duplicate some code, but protect client independence.

Acceptable duplication:

- DTO shape
- UI-specific mapping
- page composition

Bad duplication:

- business validation
- state machine rule
- authorization rule

### 28.3 Runtime Composition vs Precomputed Projection

Runtime composition:

- fresher data
- simpler initial implementation
- higher latency/failure coupling

Projection:

- faster query
- better filtering/sorting
- stale data
- replay/reconciliation complexity

### 28.4 Central Auth vs Defense-in-Depth

Gateway-only auth is simpler but riskier.

Defense-in-depth is more complex but safer.

High-security systems should prefer defense-in-depth.

---

## 29. Practical Implementation Sketch: Spring Boot BFF with Deadline

This is conceptual code, not framework tutorial.

```java
public final class Deadline {
    private final long deadlineNanos;

    private Deadline(long timeoutMillis) {
        this.deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
    }

    public static Deadline afterMillis(long timeoutMillis) {
        return new Deadline(timeoutMillis);
    }

    public long remainingMillis() {
        long remaining = deadlineNanos - System.nanoTime();
        return Math.max(0, TimeUnit.NANOSECONDS.toMillis(remaining));
    }

    public boolean expired() {
        return remainingMillis() <= 0;
    }
}
```

Example section wrapper:

```java
public record Section<T>(
    SectionStatus status,
    T data,
    String message
) {
    public static <T> Section<T> available(T data) {
        return new Section<>(SectionStatus.AVAILABLE, data, null);
    }

    public static <T> Section<T> unavailable(String message) {
        return new Section<>(SectionStatus.TEMPORARILY_UNAVAILABLE, null, message);
    }
}
```

Example statuses:

```java
public enum SectionStatus {
    AVAILABLE,
    TEMPORARILY_UNAVAILABLE,
    SKIPPED_DUE_TO_TIMEOUT,
    FORBIDDEN
}
```

Example BFF service with virtual-thread-friendly style:

```java
public ReviewPage loadReviewPage(String applicationId, UserContext user) {
    Deadline deadline = Deadline.afterMillis(1500);

    ApplicationSummary app = applicationClient.getSummary(
        applicationId,
        Duration.ofMillis(Math.min(300, deadline.remainingMillis()))
    );

    ProfileSummary profile = profileClient.getProfile(
        app.applicantId(),
        Duration.ofMillis(Math.min(300, deadline.remainingMillis()))
    );

    Section<DocumentChecklist> documents = tryLoadSection(
        () -> documentClient.getChecklist(applicationId, Duration.ofMillis(300)),
        "Document checklist is temporarily unavailable"
    );

    Section<AuditTimeline> audit = tryLoadSection(
        () -> auditClient.getTimeline(applicationId, Duration.ofMillis(250)),
        "Audit timeline is temporarily unavailable"
    );

    AvailableActions actions = applicationClient.getAvailableActions(
        applicationId,
        Duration.ofMillis(Math.min(300, deadline.remainingMillis()))
    );

    return new ReviewPage(app, profile, documents, audit, actions);
}
```

Important production additions:

- parallelize independent calls where appropriate
- propagate trace context
- apply circuit breaker/bulkhead
- use connection pool limits
- cancel work after deadline
- distinguish fallback by dependency
- emit metrics for degraded sections

---

## 30. Practical Implementation Sketch: Gateway Header Sanitization

Conceptually:

```text
Incoming request:
  X-User-Id: admin
  X-Tenant-Id: T999
  Authorization: Bearer external-token

Gateway behavior:
  1. Strip X-User-Id and X-Tenant-Id from client.
  2. Validate Authorization token.
  3. Derive trusted subject and tenant from token/session.
  4. Add internal context using trusted mechanism.
```

Internal forwarded request:

```http
Authorization: Bearer internal-token-with-audience-application-service
X-Correlation-Id: corr-123
traceparent: 00-...
```

Avoid:

```http
X-User-Id: admin
X-Roles: SUPER_ADMIN
```

unless protected by strong internal trust controls and never accepted from external clients.

---

## 31. Regulatory / Case Management Example

Imagine a regulatory platform with:

- applicant portal
- officer portal
- supervisor portal
- admin console
- external agency API

### 31.1 Suggested Edge Layout

```text
Internet Gateway
  ├── Public Applicant BFF
  ├── External Partner API Facade
  └── Public Document Upload Endpoint

Intranet Gateway
  ├── Officer Portal BFF
  ├── Supervisor Portal BFF
  ├── Admin Console BFF
  └── Internal API routes
```

### 31.2 Why Separate Gateways?

Possible reasons:

- internet vs intranet exposure
- different threat model
- different rate limits
- different authentication methods
- different logging policy
- different network routing
- different blast radius

### 31.3 Approval Page Flow

```text
Officer Browser
  → Intranet Gateway
      → Officer BFF
          → Application Service
          → Profile Service
          → Document Service
          → Screening Service
          → Audit Query Service
```

### 31.4 Approve Command Flow

```text
Officer Browser
  → Intranet Gateway
      → Officer BFF
          → Application Service approve command
              → validates state and permission
              → commits approval
              → writes outbox event
```

### 31.5 External Partner API

Partner should not call internal service topology directly.

Use external facade:

```text
Partner
  → API Management / External Gateway
      → Partner Application API Facade
          → internal services/projections
```

The facade owns partner contract stability. Internal services can evolve without exposing every internal change.

---

## 32. Red Flags in Architecture Review

Watch for these statements:

1. “Let’s put it in gateway for now.”
2. “BFF can just call all services and join the data.”
3. “Gateway already checks role, service does not need to check.”
4. “Frontend will call internal services directly.”
5. “We can cache this page by URL.”
6. “Retry at every layer should make it resilient.”
7. “If one optional section fails, return empty array.”
8. “All clients can share one generic BFF.”
9. “Gateway route config is manually updated in production.”
10. “We do not need contract tests because BFF is internal.”

Each statement may be valid in a narrow context, but as defaults they are dangerous.

---

## 33. Summary Mental Model

Keep this compact model:

```text
Gateway:
  Protect, route, normalize, observe, throttle.

BFF:
  Adapt, compose, degrade, optimize for one experience.

Domain Service:
  Decide, validate, own data, enforce invariants, audit.

Projection/Read Model:
  Serve complex cross-domain queries efficiently.

Workflow/Process Manager:
  Own long-running business coordination.
```

Do not let gateway become the brain.
Do not let BFF become the domain.
Do not let frontend dictate service boundaries.
Do not let convenience erase ownership.

---

## 34. Exercises

### Exercise 1 — Classify Responsibilities

Classify each responsibility as Gateway, BFF, Domain Service, Projection, or Workflow Owner:

1. Validate JWT signature.
2. Check whether officer can approve Application APP-001.
3. Display document section as temporarily unavailable.
4. Generate worklist sorted by SLA due date across multiple domains.
5. Apply per-tenant rate limit.
6. Submit approval command.
7. Orchestrate payment, document verification, and final issuance.
8. Strip spoofed `X-User-Id` header.
9. Convert domain error into UI message.
10. Store official application status.

Expected direction:

```text
1 Gateway / Service defense-in-depth
2 Domain Service
3 BFF
4 Projection
5 Gateway
6 Domain Service, called via BFF
7 Workflow Owner / Saga Orchestrator
8 Gateway
9 BFF
10 Domain Service
```

### Exercise 2 — Detect God Gateway Risk

Given:

```text
Gateway receives POST /submit-application.
Gateway validates applicant role.
Gateway saves application.
Gateway saves documents.
Gateway calls payment.
Gateway sends email.
Gateway creates case.
Gateway returns application number.
```

Identify what should move where.

### Exercise 3 — Design BFF Partial Response

Design response for a dashboard where:

- worklist is critical
- announcement is optional
- notification count is optional
- risk alert is critical for approve action
- audit timeline is optional

Make missing vs unavailable explicit.

### Exercise 4 — Gateway Policy Review

Create a route policy table for:

- public applicant APIs
- officer intranet APIs
- admin APIs
- external partner APIs

Include:

- route
- auth method
- rate limit
- target service/BFF
- exposed network
- owner

---

## 35. Key Takeaways

1. API Gateway is not a dumping ground for business logic.
2. BFF exists to serve a specific user experience, not to become a new monolith.
3. Gateway handles edge concerns; BFF handles experience concerns; domain service owns business correctness.
4. Runtime aggregation is useful but must be bounded by timeout, fan-out, partial response, and ownership.
5. Complex cross-service query often belongs in projection/materialized view, not gateway.
6. Gateway authorization is usually coarse; domain service must enforce object-level authorization.
7. Rate limiting, header stripping, token validation, trace propagation, and route policy must be designed explicitly.
8. Java 21+ virtual threads can simplify BFF aggregation, but do not remove the need for deadlines, bulkheads, and backpressure.
9. The strongest architecture is not the one with the most gateway features, but the one with the clearest responsibility boundaries.

---

## 36. References

- Spring Cloud Gateway official project/documentation — routing and cross-cutting concerns such as security, monitoring/metrics, and resiliency.
- Sam Newman — Backends for Frontends pattern.
- Azure Architecture Center — Backends for Frontends pattern and Gateway Aggregation pattern.
- MicroProfile JWT Authentication — JWT/OIDC/OAuth2 token validation and RBAC for microservice endpoints.
- MicroProfile 7.1 release information — Config, Fault Tolerance, Health, JWT Authentication, OpenAPI, Telemetry, REST Client, Jakarta EE 10 Core Profile.
- RFC 9110 — HTTP Semantics.
- OpenTelemetry documentation — tracing and context propagation concepts.
- OWASP API Security Top 10 — API security risks.

---

## 37. Series Progress

Current status:

```text
Completed: Part 0 through Part 13
Current:   Part 13 — API Gateway, Edge, BFF, and Experience Layer
Next:      Part 14 — Service Discovery, Configuration, and Runtime Topology
Total:     35 parts
```

This series is **not finished yet**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-12-query-pattern-api-composition-cqrs-materialized-view.md">⬅️ Learn Java Microservices Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-14-service-discovery-configuration-runtime-topology.md">Part 14 — Service Discovery, Configuration, and Runtime Topology ➡️</a>
</div>
