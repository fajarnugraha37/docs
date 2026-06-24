# learn-go-authentication-authorization-identity-permission-part-029.md

# Part 029 — API Gateway vs Service-Level Authorization: Boundary Design

> Seri: `learn-go-authentication-authorization-identity-permission`  
> Target: Go 1.26.x  
> Level: advanced / principal engineer / internal engineering handbook  
> Fokus: bagaimana membagi tanggung jawab authorization antara API gateway, edge proxy, service mesh, application service, domain layer, repository layer, worker, dan downstream service tanpa membuat gap, duplikasi berbahaya, atau false sense of security.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Core Problem: Gateway Bukan Pengganti Authorization Domain](#2-core-problem-gateway-bukan-pengganti-authorization-domain)
3. [Mental Model: Enforcement Boundary vs Decision Boundary](#3-mental-model-enforcement-boundary-vs-decision-boundary)
4. [Vocabulary Presisi](#4-vocabulary-presisi)
5. [Layer Authorization dalam Sistem Modern](#5-layer-authorization-dalam-sistem-modern)
6. [Apa yang Cocok Ditangani API Gateway](#6-apa-yang-cocok-ditangani-api-gateway)
7. [Apa yang Tidak Boleh Hanya Ditangani API Gateway](#7-apa-yang-tidak-boleh-hanya-ditangani-api-gateway)
8. [Service-Level Authorization: Resource, Workflow, Tenant, Field, Data](#8-service-level-authorization-resource-workflow-tenant-field-data)
9. [Gateway Authorization Pattern](#9-gateway-authorization-pattern)
10. [Service Authorization Pattern](#10-service-authorization-pattern)
11. [Hybrid Pattern: Edge Coarse Guard + Service Fine Guard](#11-hybrid-pattern-edge-coarse-guard--service-fine-guard)
12. [Trust Boundary dan Zero Trust View](#12-trust-boundary-dan-zero-trust-view)
13. [API Gateway as PEP, Service as PEP, PDP Placement](#13-api-gateway-as-pep-service-as-pep-pdp-placement)
14. [Claims Normalization dan Context Propagation](#14-claims-normalization-dan-context-propagation)
15. [Tenant Boundary: Kenapa Gateway Hampir Tidak Pernah Cukup](#15-tenant-boundary-kenapa-gateway-hampir-tidak-pernah-cukup)
16. [Object-Level Authorization dan BOLA/IDOR](#16-object-level-authorization-dan-bolaidor)
17. [Authorization untuk Read, Search, Export, Report, dan Aggregate](#17-authorization-untuk-read-search-export-report-dan-aggregate)
18. [Authorization untuk Write, Workflow Transition, dan Command](#18-authorization-untuk-write-workflow-transition-dan-command)
19. [Service Mesh Authorization vs Application Authorization](#19-service-mesh-authorization-vs-application-authorization)
20. [External Authorization Filter: Envoy/Istio Style](#20-external-authorization-filter-envoyistio-style)
21. [AWS API Gateway/Lambda Authorizer Style](#21-aws-api-gatewaylambda-authorizer-style)
22. [BFF Pattern dan Frontend Boundary](#22-bff-pattern-dan-frontend-boundary)
23. [gRPC, Internal APIs, Worker, Queue, dan Event Consumers](#23-grpc-internal-apis-worker-queue-dan-event-consumers)
24. [Go Reference Architecture](#24-go-reference-architecture)
25. [Go Package Design](#25-go-package-design)
26. [Go Code: Gateway Context Contract](#26-go-code-gateway-context-contract)
27. [Go Code: Service-Level PEP](#27-go-code-service-level-pep)
28. [Go Code: Repository Guard](#28-go-code-repository-guard)
29. [Go Code: Decision Reason dan Audit Evidence](#29-go-code-decision-reason-dan-audit-evidence)
30. [Caching Authorization di Gateway: Bahaya dan Strategi](#30-caching-authorization-di-gateway-bahaya-dan-strategi)
31. [Error Semantics: 401, 403, 404, 409, 423](#31-error-semantics-401-403-404-409-423)
32. [Observability dan Auditability](#32-observability-dan-auditability)
33. [Failure Modes](#33-failure-modes)
34. [Anti-Pattern](#34-anti-pattern)
35. [Decision Matrix](#35-decision-matrix)
36. [Case Study: Regulatory Case Management](#36-case-study-regulatory-case-management)
37. [Design Review Checklist](#37-design-review-checklist)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Sumber Primer](#40-sumber-primer)

---

## 1. Tujuan Part Ini

Setelah part sebelumnya, kita sudah punya fondasi:

- identity model,
- authentication,
- session,
- OAuth/OIDC,
- federation,
- RBAC,
- permission modelling,
- ABAC,
- ReBAC,
- policy-as-code,
- capability,
- multi-tenant authorization,
- service-to-service auth,
- gRPC auth.

Part ini menjawab pertanyaan arsitektural yang sering menentukan kualitas sistem produksi:

> Authorization sebaiknya dicek di API gateway atau di service?

Jawaban pendeknya:

> Gateway bagus untuk **coarse-grained enforcement**, traffic filtering, authentication verification, route-level checks, token normalization, request shaping, dan centralized guardrails.  
> Service tetap wajib melakukan **fine-grained authorization** berdasarkan resource, tenant, workflow state, ownership, data classification, field access, business authority, dan side-effect domain.

Jawaban top 1%-nya:

> Gateway dan service bukan pilihan biner. Keduanya adalah PEP pada boundary berbeda. Desain yang benar menentukan **apa yang bisa diketahui oleh gateway**, **apa yang hanya diketahui domain service**, **apa yang boleh dicache**, **apa yang harus default-deny**, dan **bagaimana decision evidence diaudit**.

---

## 2. Core Problem: Gateway Bukan Pengganti Authorization Domain

Banyak sistem enterprise tumbuh dari pola ini:

```text
Client -> API Gateway -> Service -> Database
```

Lalu tim membuat asumsi:

```text
"Semua request sudah lewat gateway, jadi service tidak perlu cek permission lagi."
```

Ini asumsi yang berbahaya.

Gateway biasanya hanya tahu:

- path,
- method,
- host,
- headers,
- token claims,
- source network,
- client certificate,
- route metadata,
- mungkin coarse scope/role.

Gateway hampir tidak pernah tahu secara lengkap:

- apakah `caseID=123` milik tenant aktif user,
- apakah case sedang pada workflow stage yang boleh diedit,
- apakah user adalah assigned officer, supervisor, reviewer, atau legal counsel,
- apakah field tertentu classified,
- apakah dokumen boleh dilihat karena confidentiality marking,
- apakah appeal sudah locked,
- apakah transition membutuhkan dual approval,
- apakah permission baru dicabut 3 detik lalu,
- apakah resource aggregate berisi data campuran tenant,
- apakah request internal berasal dari worker resmi atau compromised service.

Dengan kata lain:

```text
Gateway sees request shape.
Service sees domain truth.
```

Karena authorization adalah decision terhadap **subject + action + resource + context**, maka layer yang tidak mengetahui resource/context penuh tidak boleh menjadi satu-satunya enforcement point.

---

## 3. Mental Model: Enforcement Boundary vs Decision Boundary

Pemisahan pertama:

| Konsep | Makna |
|---|---|
| Enforcement boundary | Tempat request dihentikan atau diteruskan. |
| Decision boundary | Tempat keputusan allow/deny dihitung. |
| Knowledge boundary | Data apa yang tersedia untuk membuat keputusan. |
| Trust boundary | Batas di mana input harus dianggap tidak dipercaya. |
| Blast-radius boundary | Batas dampak ketika kontrol gagal. |

Gateway sering menjadi enforcement boundary, tetapi belum tentu decision boundary penuh.

Service sering menjadi enforcement boundary kedua dan decision boundary yang lebih kaya.

Repository/data layer sering menjadi guard terakhir untuk tenant/data scoping.

Diagram mental:

```mermaid
flowchart LR
    C[Client] --> G[API Gateway / Edge PEP]
    G --> S[Application Service / Domain PEP]
    S --> D[Domain Authorization Decision]
    D --> R[Repository / Query Guard]
    R --> DB[(Database)]

    G -. coarse context .-> PDP1[Gateway PDP]
    S -. domain context .-> PDP2[Service PDP]
    R -. tenant/data scope .-> PDP3[Data Guard]
```

Aturan praktis:

> Makin dekat ke resource dan side effect, makin spesifik authorization yang harus dilakukan.

---

## 4. Vocabulary Presisi

### 4.1 Authentication at Gateway

Gateway memverifikasi bahwa request membawa credential valid.

Contoh:

- JWT signature valid,
- issuer trusted,
- audience cocok,
- token belum expired,
- mTLS certificate trusted,
- API key valid,
- client credentials valid.

Authentication tidak menjawab apakah user boleh mengakses resource tertentu.

### 4.2 Coarse Authorization

Authorization kasar berdasarkan route/scope/role umum.

Contoh:

```text
GET /api/cases/* requires scope cases.read
POST /api/cases/* requires scope cases.write
/admin/* requires role platform_admin
```

Coarse guard bagus untuk mengurangi traffic jahat, tetapi tidak cukup untuk object-level/resource-level authorization.

### 4.3 Fine-Grained Authorization

Authorization berdasarkan domain resource dan context.

Contoh:

```text
User may view case if:
- case.tenant_id == principal.active_tenant_id
- user has case.view in that tenant
- case classification <= user clearance
- if case is confidential, user must be assigned or supervisor
- if case belongs to another division, cross-division grant is required
```

### 4.4 Defense in Depth

Gateway dan service melakukan kontrol berlapis.

Bukan berarti logic diduplikasi sembarangan. Yang benar:

```text
Gateway: cheap, broad, traffic-level guard.
Service: authoritative, domain-specific guard.
Data layer: non-bypassable tenant/data guard.
```

### 4.5 Policy Decision Point dan Policy Enforcement Point

- PEP menegakkan keputusan.
- PDP menghitung keputusan.
- Gateway bisa menjadi PEP.
- Service bisa menjadi PEP.
- PDP bisa embedded, sidecar, remote, atau custom library.

NIST Zero Trust Architecture menempatkan access decision melalui PDP dan PEP. Dalam sistem nyata, bisa ada banyak PEP pada edge, mesh, service, dan data boundary.

---

## 5. Layer Authorization dalam Sistem Modern

Authorization bukan satu titik. Ia adalah stack.

```mermaid
flowchart TD
    A[Client / User Agent]
    B[CDN / WAF]
    C[API Gateway]
    D[Service Mesh / Sidecar]
    E[Application Middleware]
    F[Domain Service]
    G[Repository / Query Builder]
    H[Database / RLS / View / Stored Guard]
    I[Object Store / Blob ACL]
    J[Queue / Worker]

    A --> B --> C --> D --> E --> F --> G --> H
    F --> I
    F --> J
```

Setiap layer punya kekuatan dan kelemahan:

| Layer | Kuat untuk | Lemah untuk |
|---|---|---|
| WAF/CDN | bot, volumetric filtering, known attack signatures | domain authorization |
| API Gateway | authn, route guard, client policy, quota, scope coarse check | object/workflow/data authorization |
| Mesh/Sidecar | service identity, L4/L7 service-to-service policy | user-resource domain decision |
| Middleware | credential extraction, principal context, common guard | deep business-specific decision jika terlalu generik |
| Domain Service | resource/workflow/tenant authorization | global network guard |
| Repository | tenant/data scoping, preventing accidental broad query | full business policy if overused |
| Database RLS | strong data boundary | application workflow nuance, external policy context |
| Worker/Event Consumer | command/event authorization | user-interactive flow context jika tidak propagated |

Top engineer tidak bertanya “gateway atau service?”, tetapi:

> Kontrol apa yang berada pada layer mana, dengan evidence apa, dan apa failure mode-nya?

---

## 6. Apa yang Cocok Ditangani API Gateway

API gateway cocok untuk hal-hal yang bisa diputuskan dari request envelope dan metadata route.

### 6.1 Credential Presence

Contoh:

- Authorization header wajib ada.
- mTLS certificate wajib ada.
- API key wajib ada untuk partner route.

### 6.2 Token Verification

Gateway dapat memverifikasi:

- signature,
- issuer,
- audience,
- expiry,
- not-before,
- token type,
- client ID,
- basic scope.

Namun service sebaiknya tetap tidak blindly trust raw token claims kecuali gateway-service trust boundary benar-benar didesain.

### 6.3 Route-Level Authorization

Contoh:

```text
GET /reports       requires reports.read
POST /reports      requires reports.create
DELETE /reports/*  requires reports.delete
```

Ini efektif sebagai early rejection.

### 6.4 Client-Level Policy

Gateway cocok mengecek:

- client app allowed to call route,
- API product/subscription,
- partner integration access,
- IP allowlist untuk partner tertentu,
- rate limit per client,
- quota per tenant/client,
- request size limit.

### 6.5 Request Normalization

Gateway bisa menormalisasi:

- canonical principal header,
- correlation ID,
- tenant candidate,
- authenticated client identity,
- source workload identity,
- authentication method reference.

Tetapi normalization harus signed/trusted atau hanya berasal dari internal gateway yang tidak dapat diakses langsung oleh client.

### 6.6 Centralized Guardrails

Contoh:

- block legacy TLS/client,
- require JWT audience,
- deny unsupported token alg,
- reject missing `x-request-id`,
- reject risky method/path,
- enforce max body size,
- enforce route-level deny-by-default.

### 6.7 Coarse Deny

Gateway ideal untuk cheap deny:

```text
No token -> 401
Invalid token -> 401
No coarse scope -> 403
Client not registered for API product -> 403
Quota exhausted -> 429
```

---

## 7. Apa yang Tidak Boleh Hanya Ditangani API Gateway

### 7.1 Object-Level Authorization

Gateway tidak tahu apakah:

```text
GET /cases/CASE-123
```

boleh diakses oleh principal tertentu, kecuali gateway melakukan lookup domain, yang biasanya membuat gateway berubah menjadi domain service tersembunyi.

### 7.2 Tenant Ownership

Gateway dapat membaca `tenant_id` dari token atau path, tetapi tidak bisa menjamin resource benar-benar milik tenant tersebut tanpa data lookup.

### 7.3 Workflow Authorization

Gateway tidak tahu apakah case sedang:

- draft,
- submitted,
- under review,
- approved,
- appealed,
- locked,
- archived.

Permission sering bergantung pada workflow state.

### 7.4 Field-Level Authorization

Gateway tidak tahu field mana yang akan dikembalikan setelah business logic berjalan.

Contoh:

- `internal_note`,
- `legal_advice`,
- `risk_score`,
- `identity_document_number`,
- `financial_evidence`,
- `case_officer_comment`.

### 7.5 Aggregation Authorization

Gateway tidak tahu apakah response aggregate berisi mixed-tenant data atau data classified.

Contoh:

```text
GET /dashboard/summary
GET /reports/export
GET /search?q=...
```

### 7.6 Side-Effect Authorization

Gateway tidak tahu semantic effect:

```text
POST /cases/123/actions/approve
POST /cases/123/actions/escalate
POST /cases/123/actions/reopen
POST /cases/123/documents
```

Endpoint yang sama bisa punya konsekuensi domain yang sangat berbeda tergantung body, state, actor, dan prior approval.

### 7.7 Internal Bypass

Kalau service hanya percaya gateway, maka akses internal dari:

- worker,
- cron,
- admin script,
- another service,
- debug endpoint,
- service mesh bypass,
- port-forward,
- test harness,
- misconfigured ingress,

bisa melewati authorization.

Top invariant:

> Service must be safe even if the gateway is bypassed, within the intended internal trust boundary.

---

## 8. Service-Level Authorization: Resource, Workflow, Tenant, Field, Data

Service-level authorization wajib untuk keputusan yang butuh domain truth.

### 8.1 Resource-Level

```go
Can(principal, "case.read", Case{ID: "CASE-123", TenantID: "CEA"})
```

### 8.2 Tenant-Level

```go
principal.ActiveTenantID == case.TenantID
```

Tetapi tidak cukup jika ada cross-tenant role.

### 8.3 Workflow-Level

```go
case.Status == UnderReview && principal.HasPermission("case.review")
```

### 8.4 Assignment-Level

```go
case.AssignedOfficerID == principal.UserID
```

### 8.5 Field-Level

```go
if !decision.AllowField("case.internal_note") {
    response.InternalNote = nil
}
```

### 8.6 Data Query-Level

Query harus dibatasi:

```sql
WHERE tenant_id = :active_tenant_id
  AND classification <= :clearance_level
```

Namun jangan mengandalkan string SQL ad-hoc di semua repository. Buat query guard terpusat.

### 8.7 Command-Level

Command harus membawa authority context:

```go
type ApproveCaseCommand struct {
    CaseID string
    Actor  auth.Principal
    Reason string
}
```

Jangan command domain berjalan tanpa actor/effective authority.

---

## 9. Gateway Authorization Pattern

Gateway sebagai PEP cocok untuk pipeline berikut:

```mermaid
sequenceDiagram
    participant Client
    participant Gateway
    participant Authz as Gateway Authorizer
    participant Service

    Client->>Gateway: HTTP request + token
    Gateway->>Gateway: Validate envelope, TLS, route, headers
    Gateway->>Authz: Check token/client/scope/route
    Authz-->>Gateway: Allow/Deny + normalized identity
    alt denied
        Gateway-->>Client: 401/403/429
    else allowed
        Gateway->>Service: Forward request + trusted context
        Service-->>Client: Response
    end
```

Typical gateway policy:

```yaml
route: GET /api/cases/{id}
requirements:
  authentication: required
  token:
    issuer: https://idp.example.gov
    audience: aceas-api
    token_type: access_token
  scopes:
    any_of:
      - cases.read
      - cases.manage
  client:
    allowed_types:
      - browser_bff
      - mobile_app
      - internal_service
```

Keputusan gateway ini hanya menjawab:

> Caller secara umum boleh memanggil route case-read.

Belum menjawab:

> Caller boleh membaca case tertentu ini.

---

## 10. Service Authorization Pattern

Service melakukan pipeline berikut:

```mermaid
sequenceDiagram
    participant Gateway
    participant Service
    participant Repo
    participant PDP
    participant DB

    Gateway->>Service: GET /cases/{id} + principal context
    Service->>Service: Reconstruct principal safely
    Service->>Repo: Load case authorization snapshot
    Repo->>DB: SELECT tenant/status/assignment/classification
    DB-->>Repo: Case authz snapshot
    Repo-->>Service: Snapshot
    Service->>PDP: Can(principal, case.read, snapshot, env)
    PDP-->>Service: Allow + obligations
    alt denied
        Service-->>Gateway: 403 or 404
    else allowed
        Service->>Repo: Load full case data with scoped query
        Repo->>DB: SELECT ... scoped
        DB-->>Repo: Case data
        Service-->>Gateway: Response filtered by field policy
    end
```

Key design:

- load minimal authorization snapshot first,
- evaluate permission,
- load full resource only if allowed,
- still use scoped query for defense,
- record decision evidence.

---

## 11. Hybrid Pattern: Edge Coarse Guard + Service Fine Guard

Recommended default untuk enterprise system:

```text
Gateway:
  - authenticate token/client
  - reject invalid/expired/untrusted token
  - check route-level scope
  - enforce rate limit/quota
  - normalize identity context
  - attach correlation/audit headers

Service:
  - verify trusted gateway context or token again
  - resolve active tenant
  - load resource auth snapshot
  - evaluate domain authorization
  - enforce field/workflow/data authorization
  - audit decision

Repository:
  - apply tenant/data/classification query guard
  - prevent accidental broad query

Database/object store:
  - optional RLS/object policy for high-risk data
```

Diagram:

```mermaid
flowchart TD
    A[Client]
    B[Gateway Coarse PEP]
    C[Service Fine PEP]
    D[PDP / Policy Engine]
    E[PIP / Domain Data]
    F[Repository Guard]
    G[(Database)]
    H[Audit Log]

    A --> B
    B -->|valid route/scope/client| C
    C --> E
    C --> D
    D --> C
    C --> F
    F --> G
    B --> H
    C --> H
    F --> H
```

---

## 12. Trust Boundary dan Zero Trust View

Zero Trust bukan slogan “jangan percaya siapa pun”. Secara engineering, ini berarti:

1. Jangan memberi trust permanen hanya karena request berasal dari network internal.
2. Setiap access ke resource harus dievaluasi berdasarkan identity, resource, action, dan context.
3. Keputusan harus least privilege.
4. Komunikasi harus diamankan.
5. Enforcement harus dekat dengan resource.
6. Policy harus observable dan auditable.

NIST SP 800-207 menggambarkan access ke enterprise resource melalui PDP dan PEP. Ini cocok dengan desain gateway + service + mesh:

- gateway PEP untuk north-south traffic,
- mesh PEP untuk east-west traffic,
- application PEP untuk domain action,
- repository/data PEP untuk data boundary.

```mermaid
flowchart LR
    U[Subject]
    PEP1[Gateway PEP]
    PEP2[Mesh PEP]
    PEP3[Service PEP]
    PEP4[Data PEP]
    PDP[PDP / Policy Engine]
    RES[Enterprise Resource]

    U --> PEP1 --> PEP2 --> PEP3 --> PEP4 --> RES
    PEP1 -. decision .-> PDP
    PEP2 -. decision .-> PDP
    PEP3 -. decision .-> PDP
    PEP4 -. decision .-> PDP
```

Important nuance:

> Zero trust does not mean every layer must repeat the exact same check. It means no layer should assume authorization is complete merely because another layer allowed the request.

---

## 13. API Gateway as PEP, Service as PEP, PDP Placement

### 13.1 Gateway as PEP

Gateway enforces decision by:

- returning 401/403,
- removing/rewriting headers,
- requiring token,
- validating client,
- calling external authorizer,
- adding identity context.

Gateway PEP is useful when:

- decision is route-level,
- policy input is request envelope,
- decision is cheap,
- policy applies globally,
- failure response can be generic.

### 13.2 Service as PEP

Service enforces decision by:

- stopping command,
- hiding field,
- filtering result,
- requiring step-up,
- applying workflow guard,
- requiring approval,
- locking resource.

Service PEP is required when:

- decision needs domain data,
- resource state matters,
- business semantics matter,
- response content changes based on permission,
- decision must be audited with domain evidence.

### 13.3 PDP Placement Options

| PDP Placement | Example | Strength | Weakness |
|---|---|---|---|
| Gateway authorizer | Lambda Authorizer, Envoy ext_authz | central route guard | limited domain context |
| Embedded service PDP | Go library, Casbin embedded, OPA SDK | low latency, domain-aware | policy distribution/versioning |
| Sidecar PDP | OPA sidecar, Envoy external authz local | decoupled deployment | operational complexity |
| Central PDP | Policy service | consistent global policy | latency, availability, blast radius |
| Hybrid | gateway coarse + service embedded | balanced | needs clear contract |

### 13.4 Recommended Default

For most serious Go enterprise systems:

```text
Gateway PEP: authentication + coarse route authorization
Service PEP: resource/workflow/tenant/field authorization
Shared PDP library or policy service: decision consistency
Repository guard: tenant/data scoping
Audit pipeline: decision evidence
```

---

## 14. Claims Normalization dan Context Propagation

Gateway often receives heterogeneous identity inputs:

- OIDC access token,
- session cookie,
- API key,
- mTLS certificate,
- SPIFFE ID,
- partner JWT,
- legacy header.

Gateway may normalize into internal context:

```text
X-Authenticated-Subject: user:123
X-Authenticated-Actor: user:123
X-Authenticated-Tenant: tenant:cea
X-Authenticated-Client: client:web-bff
X-Auth-Assurance: aal2
X-Auth-Scopes: cases.read reports.export
X-Auth-Correlation-ID: req-abc
```

But this is safe only if:

1. public clients cannot directly call service,
2. service only trusts headers from gateway/mesh,
3. gateway strips incoming spoofed headers,
4. internal connection is authenticated,
5. headers are not used beyond their authority,
6. service still performs domain authorization.

Better internal contract:

```text
External token -> gateway validates -> gateway forwards signed internal assertion
```

or:

```text
Gateway validates coarse, service validates original token again.
```

Trade-off:

| Approach | Pros | Cons |
|---|---|---|
| Forward original token | service independently verifies | every service needs token validation/JWKS |
| Forward normalized headers | simple service code | header spoofing risk if network boundary weak |
| Forward signed internal assertion | strong internal contract | key management and assertion lifecycle |
| mTLS + headers | strong transport identity | still needs header stripping/route isolation |

### 14.1 Typed Auth Context in Go

Avoid letting normalized context spread as untyped headers.

```go
package authctx

import (
    "context"
    "errors"
    "time"
)

type key struct{}

type SubjectKind string

const (
    SubjectUser    SubjectKind = "user"
    SubjectService SubjectKind = "service"
)

type Principal struct {
    SubjectKind    SubjectKind
    SubjectID      string
    ActorID        string
    TenantID       string
    ClientID       string
    Scopes         []string
    Roles          []string
    AssuranceLevel string
    AuthTime       time.Time
    Source         string // gateway, token, mtls, spiiffe, session
}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
    return context.WithValue(ctx, key{}, p)
}

func PrincipalFrom(ctx context.Context) (Principal, error) {
    p, ok := ctx.Value(key{}).(Principal)
    if !ok || p.SubjectID == "" {
        return Principal{}, errors.New("auth principal missing")
    }
    return p, nil
}
```

The service should consume `Principal`, not arbitrary headers.

---

## 15. Tenant Boundary: Kenapa Gateway Hampir Tidak Pernah Cukup

Multi-tenant authorization memerlukan tenant context yang benar.

Gateway bisa mengecek:

```text
/path contains tenant_id
jwt contains tenant claim
client is allowed for tenant
```

Tetapi service harus mengecek:

```text
resource.tenant_id == active_tenant_id
principal has permission in active_tenant_id
operation does not cross tenant without explicit grant
query/export/search does not include unauthorized tenant data
```

### 15.1 Common Tenant Bug

```go
// BAD: route-level tenant assumed enough
func GetCase(w http.ResponseWriter, r *http.Request) {
    tenantID := chi.URLParam(r, "tenantID")
    caseID := chi.URLParam(r, "caseID")

    // Gateway already checked tenantID in token, right?
    c, _ := repo.GetCaseByID(r.Context(), caseID)
    json.NewEncoder(w).Encode(c)
    _ = tenantID
}
```

Bug:

- `caseID` may belong to different tenant.
- Service trusts path tenant without resource binding.
- Repository not scoped.

Correct pattern:

```go
func GetCase(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    p := mustPrincipal(ctx)
    tenantID := chi.URLParam(r, "tenantID")
    caseID := chi.URLParam(r, "caseID")

    if tenantID != p.TenantID {
        deny(w)
        return
    }

    snap, err := repo.GetCaseAuthSnapshot(ctx, tenantID, caseID)
    if err != nil {
        notFoundOrDenied(w)
        return
    }

    dec := authorizer.Can(ctx, p, ActionCaseRead, snap)
    if !dec.Allowed {
        denyOrHide(w, dec)
        return
    }

    c, err := repo.GetCaseByIDScoped(ctx, tenantID, caseID)
    if err != nil {
        notFoundOrDenied(w)
        return
    }

    writeJSON(w, filterCase(dec, c))
}
```

---

## 16. Object-Level Authorization dan BOLA/IDOR

Broken Object Level Authorization/BOLA terjadi ketika API menerima object ID dan tidak mengecek apakah caller boleh mengakses object tersebut.

Gateway tidak cukup karena object ownership biasanya ada di database/domain service.

### 16.1 Risky Pattern

```text
GET /api/cases/{caseID}
Authorization: Bearer valid_token_with_cases.read
```

Gateway melihat:

```text
token valid + scope cases.read -> allow
```

Service harus melihat:

```text
caseID belongs to tenant/user/division/assignment/classification boundary -> allow/deny
```

### 16.2 Object Authorization Snapshot

Untuk menghindari load full sensitive resource sebelum authorization, gunakan snapshot:

```go
type CaseAuthSnapshot struct {
    CaseID          string
    TenantID        string
    Status          string
    Classification  string
    AssignedUserIDs []string
    DivisionID      string
    OwnerOrgID      string
    Locked          bool
}
```

Decision input:

```go
type DecisionRequest struct {
    Principal Principal
    Action    string
    Resource  any
    Env       Environment
}
```

### 16.3 Not Found vs Forbidden

Kadang resource existence harus disembunyikan.

Pattern:

```text
If caller has no baseline visibility for resource namespace -> 404.
If caller has visibility but lacks action -> 403.
```

Contoh:

- Case tenant lain: 404 untuk mencegah enumeration.
- Case tenant sama tapi role kurang: 403.

---

## 17. Authorization untuk Read, Search, Export, Report, dan Aggregate

Read authorization lebih sulit dari kelihatannya karena tidak hanya `GET /object/{id}`.

### 17.1 List Endpoint

```text
GET /cases?page=1
```

Harus membatasi result set:

```sql
WHERE tenant_id = :tenant_id
  AND division_id IN (:allowed_divisions)
  AND classification <= :clearance
```

Jangan load semua lalu filter di memory untuk data besar/sensitif.

### 17.2 Search Endpoint

Search bisa bocor melalui:

- result title,
- snippet,
- count,
- facet,
- autocomplete,
- suggestion,
- ranking side-channel,
- timing.

Service-level authorization harus masuk ke search query/filter.

### 17.3 Export Endpoint

Export sering melewati UI field-level masking.

Check:

- who can export,
- what fields are included,
- max row count,
- classification,
- tenant scope,
- audit reason,
- approval for sensitive export,
- watermarks,
- async job authorization.

### 17.4 Dashboard/Aggregate

Aggregate bisa membocorkan data melalui counts.

Contoh:

```text
"There are 3 active investigations in tenant X"
```

Mungkin itu sensitif walau tidak ada detail.

### 17.5 Report Builder

Report builder harus menggabungkan:

- dataset permission,
- field permission,
- row-level permission,
- export permission,
- schedule permission,
- recipient permission.

Gateway tidak punya konteks ini.

---

## 18. Authorization untuk Write, Workflow Transition, dan Command

Write bukan sekadar `POST`/`PUT`.

### 18.1 Command Authorization

Command harus dievaluasi berdasarkan:

- actor,
- authority,
- resource state,
- requested transition,
- payload field,
- risk,
- approval requirement,
- tenant boundary,
- idempotency semantics.

### 18.2 Example: Approve Case

```go
type ApproveCase struct {
    CaseID string
    Reason string
}
```

Authorization:

```text
allow if:
  principal has case.approve in tenant
  case.status == under_review
  principal is assigned supervisor or authorized reviewer
  principal is not original submitter if SoD applies
  case is not locked
  case classification <= clearance
  step-up auth is fresh if high-risk
```

### 18.3 Workflow Guard

```go
type TransitionGuard interface {
    CanTransition(ctx context.Context, p Principal, caseID string, transition string) (Decision, error)
}
```

### 18.4 Payload-Level Authorization

Example:

```json
{
  "status": "APPROVED",
  "penaltyAmount": 100000,
  "internalNote": "...",
  "notifyApplicant": true
}
```

Fields may require different permission:

| Field | Permission |
|---|---|
| `status` | `case.transition.approve` |
| `penaltyAmount` | `case.penalty.set` |
| `internalNote` | `case.internal_note.write` |
| `notifyApplicant` | `case.notification.send` |

---

## 19. Service Mesh Authorization vs Application Authorization

Service mesh can enforce:

- service A may call service B,
- namespace policy,
- workload identity,
- mTLS,
- method/path-level L7 policy,
- custom ext authz.

It usually cannot fully enforce:

- whether user can approve a specific case,
- whether response field should be hidden,
- whether workflow transition is legal,
- whether tenant query is scoped correctly,
- whether aggregate is sensitive.

### 19.1 Mesh Policy Example

```text
case-service can call document-service
report-service can call case-service read API
unknown service cannot call case-service
```

### 19.2 Application Policy Example

```text
this user can read this case document only if assigned to case or has legal review role
```

### 19.3 Layering

```mermaid
flowchart LR
    A[Service A]
    M1[Mesh PEP]
    B[Service B]
    App[App PEP]
    PDP[PDP]

    A --> M1 --> B --> App
    M1 -. workload policy .-> PDP
    App -. domain policy .-> PDP
```

Istio AuthorizationPolicy supports workload/mesh/namespace-level access control with actions such as CUSTOM, DENY, and ALLOW. That is powerful, but still not a replacement for domain authorization inside Go services.

---

## 20. External Authorization Filter: Envoy/Istio Style

Envoy external authorization filter calls an external HTTP/gRPC authorization service before forwarding request upstream.

Mental model:

```mermaid
sequenceDiagram
    participant Client
    participant Envoy
    participant Authz as External Authz Service
    participant App

    Client->>Envoy: Request
    Envoy->>Authz: Check request metadata
    alt denied
        Authz-->>Envoy: Deny
        Envoy-->>Client: 403
    else allowed
        Authz-->>Envoy: Allow + metadata
        Envoy->>App: Request + metadata
        App-->>Client: Response
    end
```

### 20.1 Good Use Cases

- route-level guard,
- tenant/client subscription,
- coarse scope check,
- central authn,
- external PDP integration,
- partner gateway checks,
- blocking known bad principal/client.

### 20.2 Risky Use Cases

- trying to do resource lookup for every object in authorizer,
- putting all business authorization in gateway,
- sharing domain DB with gateway authorizer,
- high-latency central authorizer on critical hot path,
- caching broad allow decisions without resource key,
- propagating untrusted metadata.

### 20.3 Header Injection Risk

If authorizer returns headers:

```text
x-user-id: user-123
x-tenant-id: tenant-abc
x-authz-decision: allow
```

App must ensure these headers are from Envoy, not client.

Controls:

- strip incoming `x-auth-*` from external request,
- only accept from internal listener,
- require mTLS from proxy,
- use signed assertion for high risk,
- avoid treating `x-authz-decision: allow` as universal allow.

---

## 21. AWS API Gateway/Lambda Authorizer Style

API Gateway Lambda authorizers allow custom authorization logic before invoking backend.

Important caching nuance:

> If authorization policy caching is enabled, the returned policy must be applicable to all resources/methods covered by the cache key. If method-specific policy is required, caching must be designed carefully or disabled.

This is a classic source of privilege bugs.

### 21.1 Bad Caching Pattern

```text
Cache key: Authorization token
Policy returned after GET /cases/123: Allow cases/123
Later request: DELETE /cases/999
Gateway reuses cached Allow too broadly
```

### 21.2 Safer Pattern

Include route/method/resource pattern in cache key or return narrow policies.

But if authorization needs object-level domain data, prefer service-level check.

### 21.3 Gateway Authorizer Decision Scope

Always document:

```text
This authorizer decision means:
- token is valid
- client is allowed to call API product
- token has route-level scope

This authorizer decision does NOT mean:
- user can access every object under this route
- user can see every field in response
- service may skip tenant/resource checks
```

---

## 22. BFF Pattern dan Frontend Boundary

Backend-for-Frontend/BFF often terminates browser session and calls APIs on behalf of user.

Flow:

```mermaid
flowchart LR
    Browser --> BFF[BFF / Session Holder]
    BFF --> Gateway
    Gateway --> API[Domain APIs]
```

BFF can:

- hold tokens server-side,
- protect browser from token exposure,
- manage CSRF/session,
- translate UI routes to backend API,
- perform UI-level coarse authorization.

But BFF is not final authority for domain authorization.

Why?

- BFF may have UI-specific assumptions.
- APIs may be called by mobile/internal/worker too.
- UI controls can drift from backend policy.
- BFF cannot fully know domain state unless it calls domain service anyway.

Invariant:

> Frontend/BFF may hide actions. Service must enforce actions.

---

## 23. gRPC, Internal APIs, Worker, Queue, dan Event Consumers

Authorization cannot be HTTP-only.

### 23.1 gRPC

Per-RPC authorization still needed.

Gateway route-level policy does not protect direct internal gRPC calls unless the service enforces it.

### 23.2 Worker

Workers execute commands asynchronously.

Questions:

- Who requested this job?
- Under which authority?
- Was authority valid when queued?
- Must authority be rechecked at execution time?
- What if permission changed before execution?

### 23.3 Queue/Event Consumer

Event consumers must distinguish:

- event notification,
- command request,
- privileged side effect.

If an event triggers side effect, authorization/authority must be modeled.

### 23.4 Scheduled Job

Scheduled jobs use service identity, not user identity.

They need explicit service permissions.

```text
service:archival-worker may archive closed cases older than retention period
```

Not:

```text
internal job can do anything
```

---

## 24. Go Reference Architecture

```mermaid
flowchart TD
    Client[Client]
    Gateway[API Gateway / Edge]
    AuthzGW[Gateway Authorizer]
    Service[Go Domain Service]
    AuthMW[Auth Middleware]
    DomainAuth[Domain Authorizer]
    PDP[PDP: OPA/Casbin/Custom]
    PIP[PIP: Domain Attribute Resolver]
    Repo[Repository Guard]
    DB[(Database)]
    Audit[Audit/Event Log]

    Client --> Gateway
    Gateway --> AuthzGW
    AuthzGW --> Gateway
    Gateway --> Service
    Service --> AuthMW
    AuthMW --> DomainAuth
    DomainAuth --> PIP
    DomainAuth --> PDP
    DomainAuth --> Audit
    AuthMW --> Repo
    Repo --> DB
    Repo --> Audit
```

### 24.1 Boundary Rules

1. Gateway never grants final domain access.
2. Service never trusts public headers.
3. Service may trust internal identity context only if transport boundary is authenticated.
4. Domain authorizer is called before side effect.
5. Repository guard applies tenant/data scope.
6. Audit records both gateway and service decision.
7. Deny is default.

---

## 25. Go Package Design

Recommended packages:

```text
/internal/authn
  token_verifier.go
  gateway_assertion.go
  principal.go

/internal/authctx
  context.go
  principal.go

/internal/authz
  decision.go
  authorizer.go
  action.go
  resource.go
  reason.go

/internal/authz/policy
  opa.go
  casbin.go
  custom.go

/internal/authz/pip
  case_attributes.go
  tenant_attributes.go

/internal/gatewayctx
  headers.go
  signer.go
  verifier.go

/internal/cases
  handler.go
  service.go
  repository.go
  auth_snapshot.go

/internal/audit
  decision_log.go
```

Avoid:

```text
/internal/middleware/auth.go does everything
```

Better split:

- authentication verification,
- principal reconstruction,
- domain authorization,
- repository guard,
- audit.

---

## 26. Go Code: Gateway Context Contract

### 26.1 Signed Internal Assertion

Instead of trusting arbitrary headers, gateway can create short-lived internal assertion.

```go
package gatewayctx

import "time"

type Assertion struct {
    Issuer       string    `json:"iss"`
    Audience     string    `json:"aud"`
    Subject      string    `json:"sub"`
    Actor        string    `json:"act,omitempty"`
    TenantID     string    `json:"tenant_id,omitempty"`
    ClientID     string    `json:"client_id"`
    Scopes       []string  `json:"scp"`
    Assurance    string    `json:"aal,omitempty"`
    RequestID    string    `json:"request_id"`
    IssuedAt     time.Time `json:"iat"`
    ExpiresAt    time.Time `json:"exp"`
    Source       string    `json:"src"`
}
```

Rules:

- TTL very short, e.g. 30-120 seconds.
- Audience is specific service.
- Signed by gateway internal key.
- Service verifies issuer/audience/expiry/signature.
- Assertion does not replace domain authorization.

### 26.2 Header Contract

```text
Authorization: Bearer external_access_token
X-Internal-Auth-Assertion: signed_internal_assertion
X-Request-ID: req-...
```

Service may choose:

- verify original token,
- verify internal assertion,
- require both for high-risk route.

---

## 27. Go Code: Service-Level PEP

```go
package authz

import (
    "context"
    "time"
)

type Effect string

const (
    Allow Effect = "allow"
    Deny  Effect = "deny"
)

type Action string

const (
    CaseRead    Action = "case.read"
    CaseApprove Action = "case.approve"
    CaseExport  Action = "case.export"
)

type Principal struct {
    SubjectID      string
    ActorID        string
    TenantID       string
    ClientID       string
    Scopes         []string
    Roles          []string
    AssuranceLevel string
}

type Environment struct {
    RequestID string
    IP        string
    Now       time.Time
    Channel   string // web, mobile, api, worker
}

type Decision struct {
    Effect      Effect
    Reasons     []string
    Obligations []Obligation
    PolicyID    string
    PolicyVer   string
}

type Obligation struct {
    Kind  string
    Value string
}

type Authorizer interface {
    Can(ctx context.Context, p Principal, action Action, resource any, env Environment) (Decision, error)
}
```

Handler usage:

```go
func (h *CaseHandler) GetCase(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    p := authctx.MustPrincipal(ctx)
    env := envFromRequest(r)

    caseID := pathParam(r, "caseID")

    snap, err := h.Cases.AuthSnapshot(ctx, p.TenantID, caseID)
    if err != nil {
        h.Errors.NotFound(w, r)
        return
    }

    dec, err := h.Authorizer.Can(ctx, p, authz.CaseRead, snap, env)
    if err != nil {
        h.Errors.AuthzUnavailable(w, r)
        return
    }
    if dec.Effect != authz.Allow {
        h.Audit.Decision(ctx, p, authz.CaseRead, snap, dec)
        h.Errors.Forbidden(w, r)
        return
    }

    c, err := h.Cases.GetScoped(ctx, p.TenantID, caseID)
    if err != nil {
        h.Errors.NotFound(w, r)
        return
    }

    h.Audit.Decision(ctx, p, authz.CaseRead, snap, dec)
    writeJSON(w, filterCaseForDecision(c, dec))
}
```

Notice:

- handler does not trust gateway allow as final,
- resource snapshot loaded scoped by tenant,
- authorizer receives domain snapshot,
- audit records decision,
- response may be field-filtered.

---

## 28. Go Code: Repository Guard

Repository guard prevents accidental broad access.

```go
package cases

import "context"

type Scope struct {
    TenantID       string
    AllowedDivs    []string
    MaxClassLevel  int
    IncludeDeleted bool
}

type Repository struct {
    db DB
}

func (r *Repository) GetScoped(ctx context.Context, scope Scope, caseID string) (Case, error) {
    const q = `
        SELECT id, tenant_id, division_id, status, classification, title
        FROM cases
        WHERE id = :case_id
          AND tenant_id = :tenant_id
          AND classification_level <= :max_class_level
          AND (:include_deleted = 1 OR deleted_at IS NULL)
    `

    return r.db.GetCase(ctx, q, map[string]any{
        "case_id":          caseID,
        "tenant_id":        scope.TenantID,
        "max_class_level":  scope.MaxClassLevel,
        "include_deleted":  boolToInt(scope.IncludeDeleted),
    })
}
```

Better: repository should not expose unsafe methods casually.

Avoid:

```go
func (r *Repository) GetByID(ctx context.Context, id string) (Case, error)
```

Prefer:

```go
func (r *Repository) GetScoped(ctx context.Context, scope Scope, id string) (Case, error)
```

For admin/system jobs, make scope explicit:

```go
func SystemScope(reason string) Scope
```

Do not let system scope be the default.

---

## 29. Go Code: Decision Reason dan Audit Evidence

A top-level system must record why access was allowed or denied.

```go
type DecisionEvidence struct {
    RequestID       string    `json:"request_id"`
    DecisionID      string    `json:"decision_id"`
    Time            time.Time `json:"time"`
    Effect          string    `json:"effect"`
    PrincipalID     string    `json:"principal_id"`
    ActorID         string    `json:"actor_id,omitempty"`
    TenantID        string    `json:"tenant_id"`
    ClientID        string    `json:"client_id"`
    Action          string    `json:"action"`
    ResourceType    string    `json:"resource_type"`
    ResourceID      string    `json:"resource_id"`
    ResourceTenant  string    `json:"resource_tenant"`
    PolicyID        string    `json:"policy_id"`
    PolicyVersion   string    `json:"policy_version"`
    Reasons         []string  `json:"reasons"`
    Obligations     []string  `json:"obligations,omitempty"`
    GatewayDecision string    `json:"gateway_decision,omitempty"`
    ServiceDecision string    `json:"service_decision"`
}
```

Why include gateway and service decision?

Because investigation often asks:

```text
Did edge allow the request?
Did service allow the action?
Which policy version allowed it?
Which tenant/resource was involved?
Was it user action, impersonation, delegated access, or service action?
```

---

## 30. Caching Authorization di Gateway: Bahaya dan Strategi

Authorization cache can improve latency, but it can also create severe privilege bugs.

### 30.1 Safe-ish to Cache at Gateway

- token signature verification result until token expiry,
- JWKS keys with correct cache semantics,
- client API subscription,
- route-level scope decision,
- public key metadata,
- low-risk coarse decision.

### 30.2 Dangerous to Cache at Gateway

- object-specific decision without object in cache key,
- tenant-specific decision without tenant in cache key,
- policy with changing workflow state,
- role assignments with immediate revocation requirement,
- break-glass/admin decision,
- high-risk export permission,
- field-level decision.

### 30.3 Cache Key Must Match Decision Input

If decision depends on:

```text
subject + tenant + action + resource + policy_version + attribute_version
```

then cache key must include those dimensions or the cached decision is unsafe.

### 30.4 Staleness Budget

Define:

```text
How long can a wrong allow remain valid after permission revocation?
```

For example:

| Decision Type | Max Staleness |
|---|---:|
| public route access | minutes |
| normal read route scope | token TTL |
| object read | seconds or no cache |
| export sensitive data | no cache / recheck |
| admin elevation | no cache |
| break-glass | no cache + approval |

### 30.5 Cache Negative Decisions Carefully

Deny cache can break newly granted permissions.

Use:

- short TTL,
- policy version invalidation,
- principal permission version,
- tenant membership version,
- explicit purge on grant/revoke.

---

## 31. Error Semantics: 401, 403, 404, 409, 423

Authorization design must map errors carefully.

| Status | Meaning | Example |
|---|---|---|
| 401 Unauthorized | Caller not authenticated or credential invalid | missing/expired token |
| 403 Forbidden | Caller authenticated but lacks permission | same tenant but role insufficient |
| 404 Not Found | Hide existence or truly absent | tenant mismatch or no visibility |
| 409 Conflict | action invalid due state conflict | approve already approved case |
| 423 Locked | resource locked | archived/legal hold/locked workflow |
| 429 Too Many Requests | rate/quota exceeded | brute force, quota |
| 503 Service Unavailable | PDP/authz dependency unavailable | remote PDP down if fail-closed |

### 31.1 401 vs 403

Wrong:

```text
return 401 for no permission
```

Correct:

```text
401: authentication failed/missing
403: authenticated but unauthorized
```

### 31.2 404 for Object Hiding

Use 404 when revealing existence is itself information leakage.

But audit internally as denied.

### 31.3 409 vs 403

If user is authorized to perform action but state disallows it, use 409.

Example:

```text
User can approve case, but case is already closed.
```

This is not authorization failure. It is state conflict.

---

## 32. Observability dan Auditability

### 32.1 Metrics

Useful metrics:

```text
auth_gateway_decision_total{route, effect, reason}
auth_service_decision_total{service, action, resource_type, effect, reason}
authz_pdp_latency_ms{pdp, action}
authz_cache_hit_total{layer, decision_type}
authz_cache_stale_detected_total{layer}
authz_policy_version{service, policy_id}
authz_bypass_attempt_total{service, reason}
authz_header_spoof_detected_total{service}
```

### 32.2 Logs

Log decision metadata, not secrets.

Do not log:

- access tokens,
- refresh tokens,
- raw PII if not needed,
- full SAML assertions,
- full JWTs.

Do log:

- request ID,
- principal ID,
- actor ID,
- tenant ID,
- action,
- resource ID/type,
- effect,
- reason code,
- policy ID/version,
- assurance level,
- gateway/service decision.

### 32.3 Tracing

Add spans:

```text
GatewayAuthn
GatewayAuthz
ServicePrincipalExtraction
DomainAuthz
PIPResolve
PDPDecision
RepositoryScopedQuery
```

### 32.4 Decision Replay

For regulatory defensibility, store enough evidence to replay or explain decision later.

But do not store sensitive snapshots indiscriminately.

Use:

- policy version,
- attribute version,
- resource version,
- reason code,
- minimal attribute snapshot.

---

## 33. Failure Modes

| Failure Mode | Root Cause | Impact | Control |
|---|---|---|---|
| Gateway allow treated as final | service lacks domain check | BOLA/IDOR | service-level PEP mandatory |
| Header spoofing | service trusts public headers | impersonation | strip headers, mTLS, signed assertion |
| Route scope too broad | `cases.read` grants all cases | data leakage | object-level decision |
| Tenant mismatch | path tenant not bound to resource | cross-tenant leak | repository scoped query |
| Cached allow too broad | bad cache key | privilege escalation | cache key includes full decision input |
| Internal bypass | service reachable directly | auth bypass | mesh/network policy + service verification |
| Policy drift | gateway and service use different mapping | inconsistent access | shared action registry/policy version |
| Fail-open PDP | remote PDP outage | unauthorized access | classify fail-open/closed per route |
| Deny response reveals existence | 403 for other tenant resource | enumeration | 404 for no visibility |
| Async job uses stale authority | permission revoked after queue | unauthorized side effect | execution-time recheck for high risk |
| Field masking only in UI | export bypass | sensitive field leak | service response filtering/export policy |
| Search count leakage | aggregate not scoped | inference attack | query-level filter/count policy |
| Mesh allows service identity only | no user authorization | confused deputy | propagate actor and enforce domain decision |
| Gateway DB coupling | authorizer queries domain DB | latency/blast radius | keep gateway coarse or use PDP carefully |

---

## 34. Anti-Pattern

### 34.1 “Gateway Already Checked It”

This is the most common fatal assumption.

Gateway checking route scope does not mean resource access is allowed.

### 34.2 `if role == admin` in Handlers

```go
if p.Role == "admin" {
    doAnything()
}
```

Problems:

- no tenant scope,
- no action specificity,
- no audit reason,
- no SoD,
- no temporary elevation semantics.

### 34.3 Trusting `X-User-ID`

Any header from external client must be treated as untrusted.

### 34.4 Only UI-Level Authorization

Hiding a button is UX, not enforcement.

### 34.5 Gateway as Domain Service

If gateway starts doing deep DB joins for every resource, it becomes:

- hard to maintain,
- high latency,
- tightly coupled,
- single blast-radius point,
- policy spaghetti.

### 34.6 Service Mesh as Authorization Silver Bullet

Mesh controls service-to-service traffic well. It does not know full domain resource semantics.

### 34.7 Wildcard Internal Scope

```text
scope: internal.*
```

This often becomes silent god mode.

### 34.8 Unscoped Repository Methods

```go
repo.FindByID(ctx, id)
```

In multi-tenant systems, this method is dangerous unless clearly marked internal/private and wrapped by scoped service methods.

---

## 35. Decision Matrix

### 35.1 Where Should This Check Live?

| Check | Gateway | Mesh | Service | Repository/Data |
|---|---:|---:|---:|---:|
| Token signature | yes | sometimes | optionally yes | no |
| Token issuer/audience | yes | sometimes | optionally yes | no |
| Route scope | yes | sometimes | yes for defense | no |
| Client API subscription | yes | no | optional | no |
| Service A may call Service B | optional | yes | yes for defense | no |
| User may view case 123 | no | no | yes | yes scoped query |
| Tenant ownership | weak | no | yes | yes |
| Workflow transition | no | no | yes | maybe state constraint |
| Field masking | no | no | yes | maybe view/column policy |
| Search result scoping | no | no | yes | yes |
| Export permission | coarse only | no | yes | yes |
| Admin break-glass | coarse only | optional | yes | audit/data guard |
| Quota/rate limit | yes | optional | optional | no |
| Bot/WAF | yes/CDN | no | optional | no |

### 35.2 Recommended Ownership

```text
Gateway owns: external request admission.
Mesh owns: workload communication admission.
Service owns: business action authorization.
Repository owns: data access scoping.
Audit owns: evidence and traceability.
```

---

## 36. Case Study: Regulatory Case Management

### 36.1 Scenario

System has modules:

- application,
- case,
- compliance,
- appeal,
- legal,
- document,
- report,
- audit trail,
- profile,
- correspondence.

Actors:

- applicant,
- agency officer,
- supervisor,
- compliance officer,
- legal counsel,
- system admin,
- external agency user,
- service worker.

Tenancy:

- agency,
- division,
- department,
- external partner,
- regulatory boundary.

### 36.2 Gateway Policy

```yaml
GET /api/cases/{id}:
  authentication: required
  scopes:
    any_of:
      - case.read
      - case.manage
  clients:
    any_of:
      - web-bff
      - mobile-app
      - internal-report-service
```

This rejects callers with no broad case access.

### 36.3 Service Policy

```text
allow case.read if:
  case.tenant_id == principal.active_tenant_id
  and principal has case.read in tenant
  and (
      case.classification <= principal.clearance
      or principal has case.confidential.read
  )
  and (
      principal is assigned officer
      or principal has division supervisor role for case.division
      or principal has legal counsel grant for case
      or case is public-to-agency
  )
```

### 36.4 Repository Guard

```sql
WHERE tenant_id = :tenant_id
  AND classification_level <= :max_classification
  AND deleted_at IS NULL
```

### 36.5 Report Export

Gateway:

```text
requires reports.export scope
```

Service:

```text
requires report.export permission
requires dataset access
requires field access
requires row scope
requires reason code
requires async job authority snapshot
requires audit event
```

### 36.6 Appeal Approval

Gateway:

```text
POST /api/appeals/{id}/approve requires appeal.write
```

Service:

```text
allow if:
  appeal.status == under_review
  actor has appeal.approve
  actor is not original decision maker if SoD applies
  appeal.tenant_id == active tenant
  step-up AAL2 fresh within 10 minutes
  appeal is not locked
```

### 36.7 Incident: Cross-Tenant Leak via Search

Bug:

```text
Gateway checks reports.read.
Search service queries all cases matching q.
UI filters tenant after receiving results.
Export endpoint uses same search query without UI filter.
```

Fix:

- service search query includes tenant/data guard,
- export uses same scoped query builder,
- field policy applied server-side,
- decision log includes search/export policy,
- gateway remains coarse only.

---

## 37. Design Review Checklist

### 37.1 Gateway

- [ ] Does gateway authenticate every protected route?
- [ ] Are routes deny-by-default?
- [ ] Are token issuer/audience/type validated?
- [ ] Are unsupported algorithms rejected?
- [ ] Are spoofable auth headers stripped?
- [ ] Are trusted headers only accepted from internal gateway path?
- [ ] Are route-level scopes narrow enough?
- [ ] Is authorizer cache key safe?
- [ ] Is caching disabled for high-risk route decisions?
- [ ] Are 401/403/429 mapped correctly?

### 37.2 Service

- [ ] Does service reconstruct principal safely?
- [ ] Does service perform domain authorization?
- [ ] Does service verify tenant-resource binding?
- [ ] Does service check object-level access?
- [ ] Does service enforce workflow transition rules?
- [ ] Does service enforce field-level policy?
- [ ] Does service apply server-side filtering for search/list/export?
- [ ] Does service handle internal calls and workers?
- [ ] Does service log decision evidence?
- [ ] Does service default-deny on missing context?

### 37.3 Repository/Data

- [ ] Are queries tenant-scoped?
- [ ] Are unsafe unscoped methods private or clearly restricted?
- [ ] Are list/search/export queries using shared scoped builder?
- [ ] Is object store access scoped similarly?
- [ ] Are aggregate/count queries protected?

### 37.4 Policy

- [ ] Are actions centrally registered?
- [ ] Are gateway scopes mapped to service actions explicitly?
- [ ] Are policy versions tracked?
- [ ] Are policy changes tested?
- [ ] Are emergency denies possible?
- [ ] Are revocation/staleness budgets defined?

### 37.5 Audit

- [ ] Are gateway and service decisions correlated?
- [ ] Are actor/subject/tenant/resource/action recorded?
- [ ] Is policy version recorded?
- [ ] Is denial reason recorded internally?
- [ ] Are tokens/secrets excluded from logs?
- [ ] Can investigator reconstruct why access was allowed?

---

## 38. Latihan

### Latihan 1 — Classify Authorization Checks

Untuk setiap check berikut, tentukan layer utamanya:

1. JWT issuer valid.
2. User boleh membaca case tertentu.
3. Service `report-service` boleh memanggil `case-service`.
4. User boleh export report berisi financial evidence.
5. Query list case harus tenant-scoped.
6. Request body terlalu besar.
7. User boleh mengubah `penaltyAmount`.
8. Worker boleh menjalankan scheduled archival.

Jawaban ideal:

1. Gateway/service token verifier.
2. Service + repository.
3. Mesh + service.
4. Service + repository + audit.
5. Repository/data guard.
6. Gateway.
7. Service field/payload policy.
8. Service-to-service/workload authorization + command policy.

### Latihan 2 — Find the Bug

```go
func DeleteDocument(w http.ResponseWriter, r *http.Request) {
    p := authctx.MustPrincipal(r.Context())
    if !p.HasScope("document.delete") {
        http.Error(w, "forbidden", http.StatusForbidden)
        return
    }

    id := chi.URLParam(r, "documentID")
    _ = repo.DeleteByID(r.Context(), id)
    w.WriteHeader(http.StatusNoContent)
}
```

Bug:

- scope is route-level, not object-level,
- no tenant check,
- no document ownership/case binding,
- no workflow/legal hold check,
- unscoped delete,
- no audit reason,
- no soft delete / irreversible delete policy.

Better design:

- load document auth snapshot,
- check tenant/case/classification/legal hold,
- evaluate `document.delete`,
- require step-up/admin approval for permanent delete,
- call scoped repository delete,
- audit decision.

### Latihan 3 — Design Cache Key

Decision:

```text
Can user export report R from tenant T with fields F under policy P?
```

Cache key must include at least:

```text
subject_id
actor_id if impersonation/delegation
tenant_id
action=report.export
report_id or dataset_id
field_set_hash
policy_version
permission_version
attribute_version/risk version if applicable
```

If that seems too much, do not cache the allow decision.

---

## 39. Ringkasan

API gateway dan service-level authorization bukan kompetitor. Mereka adalah kontrol pada boundary berbeda.

Gateway sangat baik untuk:

- authentication,
- route-level scope,
- client policy,
- quota/rate limit,
- traffic admission,
- coarse deny,
- centralized guardrails.

Service wajib untuk:

- resource authorization,
- tenant boundary,
- object-level checks,
- workflow transitions,
- field masking,
- export/search/report security,
- business authority,
- audit evidence,
- internal/worker/gRPC protection.

Repository/data layer wajib membantu dengan:

- tenant-scoped query,
- row/data guard,
- safe default API,
- preventing accidental broad access.

Top invariant:

> Gateway may say “this caller can enter this route.”  
> Only the service/domain layer can say “this caller can perform this action on this resource in this context.”

Top 1% engineering mindset:

> Jangan desain authorization berdasarkan letak komponen. Desain berdasarkan **knowledge required for the decision**, **where enforcement can happen**, **how bypass is prevented**, **how stale decisions are bounded**, dan **how evidence is reconstructed later**.

---

## 40. Sumber Primer

Sumber berikut menjadi baseline faktual untuk part ini:

1. Go 1.26 Release Notes — https://go.dev/doc/go1.26
2. NIST SP 800-207 Zero Trust Architecture — https://csrc.nist.gov/pubs/sp/800/207/final
3. NIST SP 800-162 Attribute Based Access Control — https://csrc.nist.gov/pubs/sp/800/162/upd2/final
4. OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
5. OWASP API Security Top 10 2023 — Broken Object Level Authorization — https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
6. OWASP Top 10 2021 — Broken Access Control — https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/
7. Envoy External Authorization Filter — https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ext_authz_filter
8. Envoy HTTP ext_authz Filter — https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter
9. Istio Authorization Policy — https://istio.io/latest/docs/reference/config/security/authorization-policy/
10. Istio Security Concepts — https://istio.io/latest/docs/concepts/security/
11. AWS API Gateway Lambda Authorizers — https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-use-lambda-authorizer.html
12. AWS HTTP API Lambda Authorizers — https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html
13. Google BeyondProd Security — https://docs.cloud.google.com/docs/security/beyondprod
14. gRPC Authentication Guide — https://grpc.io/docs/guides/auth/
15. gRPC Metadata Guide — https://grpc.io/docs/guides/metadata/

---

## Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-go-authentication-authorization-identity-permission-part-030.md
```

Topik berikutnya:

```text
Authorization in Distributed Systems: Caching, Consistency, Staleness, Revocation
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-authentication-authorization-identity-permission-part-028.md">⬅️ Part 028 — gRPC Auth: Metadata, Interceptor Chain, Per-RPC Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-authentication-authorization-identity-permission-part-030.md">Part 030 — Authorization in Distributed Systems: Caching, Consistency, Staleness, Revocation ➡️</a>
</div>
