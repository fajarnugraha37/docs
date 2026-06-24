# learn-go-authentication-authorization-identity-permission-part-027.md

# Part 027 — Service-to-Service Auth: mTLS, JWT Bearer, Client Credentials, Workload Identity

> Seri: `learn-go-authentication-authorization-identity-permission`  
> Fokus: Go 1.26.x, distributed systems, enterprise/regulatory-grade authorization  
> Posisi: setelah token lifecycle, middleware, OAuth/OIDC, federation, PDP/PEP, RBAC/ABAC/ReBAC, policy-as-code, capability-based access, dan multi-tenant authorization.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Inti: Human Identity Bukan Workload Identity](#2-masalah-inti-human-identity-bukan-workload-identity)
3. [Terminologi Presisi](#3-terminologi-presisi)
4. [Mental Model: Service-to-Service Auth sebagai Identity Supply Chain](#4-mental-model-service-to-service-auth-sebagai-identity-supply-chain)
5. [Threat Model Khusus Service-to-Service Auth](#5-threat-model-khusus-service-to-service-auth)
6. [Invariants Desain](#6-invariants-desain)
7. [Taxonomy Mekanisme Auth Antar-Service](#7-taxonomy-mekanisme-auth-antar-service)
8. [Client Credentials Flow](#8-client-credentials-flow)
9. [JWT Bearer Client Authentication dan JWT Bearer Grant](#9-jwt-bearer-client-authentication-dan-jwt-bearer-grant)
10. [mTLS: Mutual TLS sebagai Channel dan Client Authentication](#10-mtls-mutual-tls-sebagai-channel-dan-client-authentication)
11. [Certificate-Bound Access Token](#11-certificate-bound-access-token)
12. [SPIFFE/SPIRE dan Workload Identity](#12-spiffespire-dan-workload-identity)
13. [X.509-SVID vs JWT-SVID](#13-x509-svid-vs-jwt-svid)
14. [Service Account, Workload, Instance, Pod, Job, dan Actor Chain](#14-service-account-workload-instance-pod-job-dan-actor-chain)
15. [Identity Propagation vs Delegation](#15-identity-propagation-vs-delegation)
16. [Authorization Antar-Service: Jangan Berhenti di Authentication](#16-authorization-antar-service-jangan-berhenti-di-authentication)
17. [Go Architecture: Package Boundary](#17-go-architecture-package-boundary)
18. [Go Domain Types](#18-go-domain-types)
19. [Pattern 1: Outbound OAuth2 Client Credentials di Go](#19-pattern-1-outbound-oauth2-client-credentials-di-go)
20. [Pattern 2: Inbound JWT Bearer Validation untuk Service API](#20-pattern-2-inbound-jwt-bearer-validation-untuk-service-api)
21. [Pattern 3: Basic mTLS Server dan Client di Go](#21-pattern-3-basic-mtls-server-dan-client-di-go)
22. [Pattern 4: SPIFFE mTLS dengan go-spiffe](#22-pattern-4-spiffe-mtls-dengan-go-spiffe)
23. [Pattern 5: JWT-SVID untuk HTTP/gRPC Bearer Credential](#23-pattern-5-jwt-svid-untuk-httpgrpc-bearer-credential)
24. [Pattern 6: Gateway-to-Service Identity Forwarding](#24-pattern-6-gateway-to-service-identity-forwarding)
25. [Pattern 7: Worker/Job Identity](#25-pattern-7-workerjob-identity)
26. [Pattern 8: Event-Driven Service Identity](#26-pattern-8-event-driven-service-identity)
27. [gRPC Service-to-Service Auth Preview](#27-grpc-service-to-service-auth-preview)
28. [Multi-Tenant Service-to-Service Auth](#28-multi-tenant-service-to-service-auth)
29. [Secret Management dan Credential Rotation](#29-secret-management-dan-credential-rotation)
30. [Caching, Expiry, Revocation, dan Staleness](#30-caching-expiry-revocation-dan-staleness)
31. [Auditability: Siapa Memanggil Siapa, Sebagai Apa, Untuk Apa](#31-auditability-siapa-memanggil-siapa-sebagai-apa-untuk-apa)
32. [Observability yang Aman](#32-observability-yang-aman)
33. [Testing Strategy](#33-testing-strategy)
34. [Performance Engineering](#34-performance-engineering)
35. [Failure Modes Matrix](#35-failure-modes-matrix)
36. [Anti-Pattern yang Harus Dihindari](#36-anti-pattern-yang-harus-dihindari)
37. [Reference Architecture](#37-reference-architecture)
38. [Case Study: Regulatory Case Management Platform](#38-case-study-regulatory-case-management-platform)
39. [Checklist Production Readiness](#39-checklist-production-readiness)
40. [Pertanyaan Review](#40-pertanyaan-review)
41. [Ringkasan](#41-ringkasan)
42. [Referensi Primer](#42-referensi-primer)

---

## 1. Tujuan Bagian Ini

Bagian ini membahas **authentication dan authorization antar-service** dalam sistem Go modern.

Pada level basic, service-to-service auth sering dipahami seperti ini:

> Service A punya API key. Service B mengecek API key. Selesai.

Pada level production, terutama dalam sistem enterprise, financial, public-sector, atau regulatory, model itu terlalu rapuh. Yang sebenarnya perlu dijawab adalah:

1. **Workload apa** yang memanggil?
2. **Instance mana** yang memanggil?
3. **Dari environment mana** panggilan berasal?
4. **Dengan credential apa** identitas itu dibuktikan?
5. **Apakah credential itu masih valid, tidak dicuri, tidak stale, dan tidak over-privileged?**
6. **Apakah service pemanggil memang boleh melakukan action ini?**
7. **Apakah panggilan ini mewakili dirinya sendiri, user tertentu, job tertentu, tenant tertentu, atau delegation chain tertentu?**
8. **Bagaimana keputusan itu bisa diaudit setelah insiden?**

Bagian ini akan membangun mental model dan implementasi Go untuk:

- OAuth2 Client Credentials.
- JWT Bearer client authentication.
- JWT Bearer authorization grant.
- mTLS.
- certificate-bound access tokens.
- SPIFFE/SPIRE workload identity.
- service account lifecycle.
- outbound credential acquisition.
- inbound credential validation.
- authorization antar-service.
- worker/job identity.
- event-driven identity.
- identity propagation vs delegation.
- failure modelling.

Yang tidak akan diulang detail:

- TLS handshake internals secara kriptografi.
- JWT/JWKS validation detail dari Part 010.
- OAuth2 fundamentals dari Part 013.
- token lifecycle dari Part 011.
- PEP/PDP detail dari Part 019.
- multi-tenant auth detail dari Part 026.

Namun semua itu akan dipakai sebagai pondasi.

---

## 2. Masalah Inti: Human Identity Bukan Workload Identity

Dalam sistem enterprise, ada dua keluarga identity besar:

| Jenis Identity | Contoh | Risiko utama |
|---|---|---|
| Human identity | user, admin, investigator, reviewer | account takeover, session hijack, phishing, privilege abuse |
| Workload identity | service, pod, job, worker, connector, batch, scheduler | credential theft, service impersonation, lateral movement, over-privileged service account |

Human identity biasanya punya:

- login ceremony,
- MFA,
- session,
- browser/device,
- consent,
- account recovery,
- user lifecycle.

Workload identity biasanya punya:

- deployment identity,
- runtime identity,
- service account,
- certificate/token,
- attestation,
- secret injection,
- node/pod/job metadata,
- short-lived credential,
- policy-bound access.

Kesalahan besar yang sering terjadi:

> Sistem memperlakukan service-to-service call sebagai “trusted internal traffic”.

Padahal pada distributed systems modern:

- internal network bisa ditembus,
- pod bisa compromised,
- sidecar bisa salah konfigurasi,
- service account bisa bocor,
- token bisa tertulis di log,
- queue message bisa diproses oleh worker yang salah,
- internal gateway bisa dibypass,
- staging credential bisa dipakai ke production,
- service bisa memanggil endpoint yang bukan haknya,
- multi-tenant boundary bisa bocor melalui internal API.

Top engineer tidak bertanya:

> “Apakah request ini datang dari cluster internal?”

Mereka bertanya:

> “Identitas workload apa yang dibuktikan secara kriptografis, oleh authority mana, untuk audience mana, dengan freshness apa, dan apakah policy mengizinkan action-resource-tenant-context ini?”

---

## 3. Terminologi Presisi

### 3.1 Workload

**Workload** adalah unit komputasi yang menjalankan kode dan perlu berinteraksi dengan resource lain.

Contoh:

- API service.
- background worker.
- cron job.
- migration job.
- message consumer.
- event publisher.
- connector service.
- report generator.
- CI/CD job.
- database maintenance tool.

Workload bukan hanya “service name”. Workload adalah runtime actor.

### 3.2 Service Identity

**Service identity** adalah identitas logis dari service.

Contoh:

```text
case-service
notification-service
payment-service
audit-export-worker
onemap-connector
```

Service identity biasanya lebih stabil daripada pod/container instance.

### 3.3 Workload Instance Identity

**Workload instance identity** adalah identitas spesifik instance runtime.

Contoh:

```text
case-service pod abc123 in namespace aceas-prod
notification-worker job run 2026-06-24T10:00:00Z
```

Authorization biasanya tidak memakai instance identity sebagai permission utama, tetapi instance metadata penting untuk:

- audit,
- incident response,
- rate limiting,
- attestation,
- anomaly detection,
- blast radius analysis.

### 3.4 Service Account

**Service account** adalah representasi administratif dari workload yang diberi credential atau grant.

Di Kubernetes, service account sering melekat ke pod. Di cloud provider, service account bisa berarti IAM principal. Di OAuth, client credentials bisa merepresentasikan confidential client/service account.

Masalah utama:

> Banyak organisasi memperlakukan service account sebagai “password bersama untuk service”.

Service account harus punya lifecycle:

- owner,
- purpose,
- environment,
- allowed audience,
- allowed resource,
- rotation policy,
- revocation path,
- audit trail,
- least privilege,
- expiry/review.

### 3.5 Credential

Credential adalah bukti yang dipakai workload untuk membuktikan identity.

Contoh:

- client secret,
- private key,
- signed JWT client assertion,
- mTLS client certificate,
- X.509-SVID,
- JWT-SVID,
- cloud workload identity token,
- short-lived OAuth access token.

Credential bukan identity. Credential adalah evidence.

### 3.6 Authentication

Authentication antar-service menjawab:

> “Apakah caller benar-benar workload X?”

### 3.7 Authorization

Authorization antar-service menjawab:

> “Apakah workload X boleh melakukan action Y terhadap resource Z dalam tenant/context C?”

### 3.8 Audience

Audience adalah target valid credential/token.

Contoh:

```text
aud = https://case-api.internal
aud = notification-service
aud = spiffe://example.org/ns/prod/sa/case-service
```

Tanpa audience binding, token untuk Service B bisa disalahgunakan ke Service C.

### 3.9 Trust Domain

Trust domain adalah boundary authority yang menerbitkan identity.

Contoh SPIFFE ID:

```text
spiffe://agency.gov/ns/prod/sa/case-service
```

`agency.gov` adalah trust domain.

### 3.10 Attestation

Attestation adalah proses authority memverifikasi bahwa workload berhak menerima identity tertentu.

Contoh signal:

- node identity,
- Kubernetes service account,
- namespace,
- pod label,
- image digest,
- cloud instance metadata,
- workload selector,
- CI job metadata.

### 3.11 Caller, Subject, Actor

Dalam service-to-service auth, jangan campur tiga hal ini:

| Konsep | Arti |
|---|---|
| Caller | workload yang secara langsung melakukan request |
| Subject | entity yang menjadi target authority/identity utama |
| Actor | entity yang bertindak, bisa service atau user delegated |

Contoh:

```text
User U menekan tombol approve.
case-service menerima request user.
case-service memanggil workflow-service.
workflow-service memanggil audit-service.
```

Di `audit-service`:

- caller langsung: `workflow-service`
- upstream service: `case-service`
- human actor: `user U`
- tenant: `CEA`
- action: `record_approval_audit`

Jika audit hanya mencatat “workflow-service did it”, forensic quality rendah. Jika audit hanya mencatat “user U did it”, system accountability hilang.

---

## 4. Mental Model: Service-to-Service Auth sebagai Identity Supply Chain

Service-to-service auth bukan satu middleware. Ia adalah supply chain:

```mermaid
flowchart LR
    Code[Source Code / Deployment Spec]
    Runtime[Runtime Workload]
    Attestor[Node/Platform Attestation]
    Issuer[Identity Issuer / AS / SPIRE]
    Credential[Short-Lived Credential]
    Caller[Calling Service]
    Network[Transport]
    Callee[Receiving Service]
    PEP[Policy Enforcement Point]
    PDP[Policy Decision Point]
    Resource[Protected Resource]
    Audit[Decision + Access Audit]

    Code --> Runtime
    Runtime --> Attestor
    Attestor --> Issuer
    Issuer --> Credential
    Credential --> Caller
    Caller --> Network
    Network --> Callee
    Callee --> PEP
    PEP --> PDP
    PDP --> Resource
    PEP --> Audit
```

Setiap panah punya failure mode:

- Deployment spec salah memberi service account.
- Runtime compromised.
- Attestation selector terlalu luas.
- Issuer salah menerbitkan identity.
- Credential terlalu panjang umur.
- Token tidak audience-bound.
- Network hanya mengandalkan IP allowlist.
- Callee menerima header palsu.
- PEP skip authorization untuk internal call.
- PDP memakai cache stale.
- Audit tidak mencatat actor chain.

Top 1% engineer melihat auth antar-service sebagai sistem end-to-end, bukan library token parser.

---

## 5. Threat Model Khusus Service-to-Service Auth

### 5.1 Service Impersonation

Attacker membuat request seolah-olah dari service tepercaya.

Penyebab:

- static API key bocor,
- header `X-Service-Name` dipercaya,
- internal network dianggap trusted,
- mTLS tidak memvalidasi SAN/URI identity,
- token tidak memuat issuer/audience yang benar,
- gateway men-forward identity tanpa signature atau mTLS.

### 5.2 Credential Exfiltration

Credential workload dicuri dari:

- environment variable,
- Kubernetes Secret,
- mounted file,
- log,
- crash dump,
- debug endpoint,
- CI output,
- container image layer,
- developer laptop,
- monitoring agent,
- proxy dump.

Mitigasi:

- short-lived credential,
- rotation,
- no long-lived shared secrets,
- workload API instead of secret injection,
- sender-constrained token,
- least privilege,
- audit and anomaly detection.

### 5.3 Lateral Movement

Service yang compromised dipakai untuk mengakses service lain.

Contoh:

```text
notification-service compromised
    -> calls case-service internal admin endpoint
    -> reads case data
    -> exports tenant data
```

Mitigasi:

- service-level authorization,
- allowlist per caller/action/resource,
- deny-by-default,
- audience-bound token,
- mTLS peer identity,
- network policy sebagai tambahan, bukan auth utama.

### 5.4 Token Replay

Token valid dicuri dan dipakai ulang oleh attacker.

Mitigasi:

- short TTL,
- mTLS-bound token,
- DPoP-like proof for HTTP clients,
- nonce/jti replay cache untuk high-risk operations,
- audience binding,
- token exchange dengan scope sempit.

### 5.5 Confused Deputy

Service yang punya privilege tinggi diminta melakukan sesuatu oleh caller yang tidak berhak.

Contoh:

```text
report-service boleh query banyak data.
low-privileged service memanggil report-service dengan tenant/resource arbitrary.
report-service tidak cek caller authority.
```

Mitigasi:

- caller authorization,
- propagated user/tenant context validation,
- delegation token,
- capability token,
- purpose-bound internal API.

### 5.6 Environment Confusion

Credential staging dipakai ke production atau sebaliknya.

Mitigasi:

- issuer per environment,
- trust domain per environment,
- audience per environment,
- tenant/environment claim,
- hard fail jika environment mismatch.

### 5.7 Tenant Breakout via Internal API

Internal service menerima `tenant_id` dari caller tanpa memastikan caller boleh mengakses tenant itu.

Mitigasi:

- tenant-bound token,
- tenant authorization di callee,
- query guard,
- tenant context from validated auth context, not raw request parameter.

---

## 6. Invariants Desain

### Invariant 1 — Internal Network Bukan Security Boundary

Network policy, private subnet, service mesh, firewall, atau VPC hanya lapisan tambahan. Service tetap harus memvalidasi identity dan authorization.

### Invariant 2 — Identity Harus Dibuktikan, Bukan Diklaim

Header seperti ini tidak boleh dipercaya dari caller arbitrary:

```http
X-Service-Name: case-service
X-User-ID: 123
X-Tenant-ID: CEA
```

Header identity hanya boleh dipercaya jika:

- berasal dari trusted gateway,
- gateway identity dibuktikan,
- header dibersihkan dari inbound public request,
- hop boundary jelas,
- ada mTLS/signed internal header/token,
- service downstream tahu trust contract-nya.

### Invariant 3 — Authentication Tidak Cukup

`payment-service` authenticated bukan berarti ia boleh memanggil `case-service.deleteCase`.

### Invariant 4 — Token Harus Audience-Bound

Token tanpa audience mudah menjadi universal bearer.

### Invariant 5 — Credential Harus Punya Lifecycle

Credential harus punya:

- issuer,
- subject,
- audience,
- expiry,
- revocation path,
- owner,
- rotation plan,
- audit trail.

### Invariant 6 — Service Identity Harus Environment-Bound

`case-service.dev` tidak boleh diterima sebagai `case-service.prod`.

### Invariant 7 — Propagated User Context Bukan Pengganti Caller Auth

Service downstream perlu mengetahui:

- caller service,
- propagated human actor,
- delegation authority,
- tenant,
- purpose.

### Invariant 8 — Authorization Decision Harus Bisa Diaudit

Audit minimal:

- direct caller identity,
- authenticated credential type,
- subject/actor chain,
- tenant,
- action,
- resource,
- decision,
- policy version,
- reason code,
- correlation ID.

---

## 7. Taxonomy Mekanisme Auth Antar-Service

| Mekanisme | Cocok untuk | Kelebihan | Risiko |
|---|---|---|---|
| Static API key | legacy/simple integration | sederhana | long-lived, mudah bocor, sulit rotate |
| Basic client secret | OAuth confidential client | umum | secret lifecycle lemah jika disimpan sembarang |
| Client Credentials | service acting as itself | standar OAuth2 | bearer token replay jika tidak constrained |
| JWT client assertion | client auth tanpa shared secret | private key bisa dirotasi | validasi assertion harus benar |
| JWT bearer grant | token exchange/assertion-based delegation | federated workload | assertion replay/audience mismatch |
| mTLS | strong channel + client cert auth | cryptographic peer identity | cert lifecycle kompleks |
| cert-bound access token | token theft resistance | replay lebih sulit | AS/RS harus konsisten validasi cert binding |
| SPIFFE X.509-SVID | platform-neutral workload mTLS | short-lived, attested | perlu identity control plane |
| SPIFFE JWT-SVID | bearer/proof workload token | cocok non-TLS hop | audience dan expiry wajib ketat |
| Cloud workload identity | cloud-native integration | tanpa static secret | provider-specific, mapping harus hati-hati |
| Service mesh identity | transparent mTLS | operasional mudah | app tetap perlu authorization context |

---

## 8. Client Credentials Flow

OAuth2 Client Credentials digunakan ketika client bertindak atas nama dirinya sendiri, bukan atas nama user.

Flow konseptual:

```mermaid
sequenceDiagram
    participant S as Service A
    participant AS as Authorization Server
    participant API as Service B / Resource Server

    S->>AS: POST /token grant_type=client_credentials + client auth
    AS->>AS: authenticate client + evaluate allowed scope/audience
    AS-->>S: access_token
    S->>API: Authorization: Bearer access_token
    API->>API: validate token issuer/audience/scope/client identity
    API-->>S: protected response
```

Client Credentials cocok untuk:

- service calling another service as itself,
- scheduled job,
- machine-to-machine integration,
- backend connector,
- internal automation,
- CI/CD calling deployment API.

Tidak cocok untuk:

- user delegation tanpa actor context,
- browser public client dengan secret,
- long-running universal access,
- replacing resource-level authorization.

### 8.1 Client Credentials bukan “superuser service token”

Kesalahan umum:

```text
client_id = internal-service
scope = *
audience = *
```

Ini menciptakan skeleton key.

Desain yang lebih baik:

```text
client_id = case-service-prod
audience = notification-api-prod
scope = notification.email.send notification.template.render
```

atau lebih eksplisit:

```json
{
  "iss": "https://idp.prod.example.gov",
  "sub": "client:case-service-prod",
  "aud": "notification-service",
  "scope": "notification:send",
  "tenant": "cea",
  "env": "prod",
  "iat": 1782300000,
  "exp": 1782300300
}
```

### 8.2 Scope dalam Client Credentials

Scope harus merepresentasikan capability yang diberikan kepada client.

Contoh buruk:

```text
scope = admin
```

Contoh lebih baik:

```text
case.read
case.status.update
notification.email.send
audit.event.write
report.export.create
```

Contoh yang lebih machine-friendly:

```text
case:read
case:update_status
notification:send_email
audit:write_event
report:create_export
```

Namun scope tetap coarse. Untuk fine-grained decision, resource server harus cek:

- caller,
- action,
- resource,
- tenant,
- business constraint,
- policy version.

---

## 9. JWT Bearer Client Authentication dan JWT Bearer Grant

RFC 7523 mendefinisikan dua penggunaan JWT dalam OAuth2:

1. JWT sebagai **authorization grant**.
2. JWT sebagai **client authentication**.

Keduanya sering tercampur.

### 9.1 JWT Client Assertion

Client membuktikan dirinya ke token endpoint dengan JWT yang ditandatangani private key.

Request konseptual:

```http
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&
client_assertion=eyJhbGciOiJSUzI1NiIs...
```

Assertion claims umum:

```json
{
  "iss": "case-service-prod",
  "sub": "case-service-prod",
  "aud": "https://idp.prod.example.gov/oauth/token",
  "jti": "unique-assertion-id",
  "iat": 1782300000,
  "exp": 1782300300
}
```

Validator token endpoint harus memastikan:

- `iss` dikenal sebagai client.
- `sub` cocok dengan client.
- `aud` adalah token endpoint.
- signature valid memakai registered public key/JWKS client.
- `exp` pendek.
- `jti` tidak replay untuk window tertentu.
- algorithm sesuai allowlist.
- key lifecycle valid.

### 9.2 JWT Bearer Grant

JWT dipakai sebagai grant untuk memperoleh access token.

Contoh use case:

- federation antar-domain,
- workload dari external trust domain,
- token exchange dari CI/CD identity,
- assertion dari identity provider lain.

Perbedaannya:

| Mekanisme | JWT membuktikan apa? |
|---|---|
| client assertion | client authentication ke AS |
| JWT bearer grant | grant/authority untuk mendapat token |

Dalam enterprise system, satu request bisa memakai keduanya:

```text
client_assertion -> membuktikan client
assertion grant  -> membuktikan delegated authority
```

---

## 10. mTLS: Mutual TLS sebagai Channel dan Client Authentication

TLS server authentication menjawab:

> “Apakah client berbicara dengan server yang benar?”

mTLS menambahkan:

> “Apakah server juga dapat memverifikasi identity client?”

Flow:

```mermaid
sequenceDiagram
    participant C as Client Service
    participant S as Server Service
    C->>S: TLS ClientHello
    S-->>C: Server certificate
    C->>C: validate server certificate
    S-->>C: request client certificate
    C-->>S: client certificate
    S->>S: validate client certificate chain + identity
    C->>S: encrypted HTTP/gRPC request
    S->>S: authorize peer identity + request context
    S-->>C: response
```

mTLS dapat dipakai untuk:

- direct service peer authentication,
- service mesh identity,
- OAuth client authentication ke token endpoint,
- certificate-bound token proof,
- internal gateway-to-service identity,
- SPIFFE X.509-SVID communication.

### 10.1 mTLS Membuktikan Channel Peer, Bukan User

mTLS menjawab direct peer identity:

```text
caller = case-service
```

mTLS tidak otomatis menjawab:

```text
human actor = Alice
case tenant = CEA
resource = CASE-123
permission = approve
```

Karena itu mTLS harus dikombinasikan dengan:

- propagated actor context,
- delegation/capability token,
- request-level authorization,
- audit chain.

### 10.2 Certificate Identity

Jangan mengandalkan Common Name lama. Gunakan SAN yang jelas:

- DNS SAN,
- URI SAN,
- SPIFFE URI SAN.

Contoh SPIFFE URI SAN:

```text
spiffe://agency.gov/ns/prod/sa/case-service
```

### 10.3 mTLS Failure Modes

| Failure | Dampak |
|---|---|
| CA terlalu luas | service dari environment lain diterima |
| tidak cek SAN/URI | cert valid tapi identity salah |
| trust store stale | cert baru ditolak atau cert revoked diterima |
| cert terlalu long-lived | credential theft berdampak lama |
| cert rotation tidak seamless | outage saat expiry |
| mTLS hanya di gateway | service internal bypass tidak terlindungi |
| tidak ada authorization setelah mTLS | semua authenticated services dianggap trusted |

---

## 11. Certificate-Bound Access Token

Bearer token punya masalah fundamental:

> Siapa pun yang memegang token bisa menggunakannya.

Certificate-bound access token mengikat token ke certificate tertentu. Resource server tidak cukup memvalidasi JWT; ia juga harus memastikan certificate yang dipakai dalam mTLS cocok dengan confirmation claim di token.

Konsep token:

```json
{
  "iss": "https://idp.prod.example.gov",
  "sub": "client:case-service-prod",
  "aud": "notification-service",
  "scope": "notification:send",
  "cnf": {
    "x5t#S256": "base64url-sha256-cert-thumbprint"
  },
  "exp": 1782300300
}
```

Resource server harus memvalidasi:

1. TLS client certificate ada.
2. Access token valid.
3. Token `cnf.x5t#S256` cocok dengan certificate thumbprint.
4. Issuer/audience/scope valid.
5. Caller authorized untuk action/resource.

Tanpa langkah 3, token masih bearer biasa.

---

## 12. SPIFFE/SPIRE dan Workload Identity

SPIFFE menyediakan standar untuk workload identity. SPIRE adalah salah satu implementasi production-ready untuk menerbitkan identity tersebut.

Mental model:

```mermaid
flowchart TD
    Workload[Workload / Pod / Process]
    Agent[SPIRE Agent / Workload API]
    Server[SPIRE Server]
    Attest[Node + Workload Attestation]
    SVID[SVID: X.509 or JWT]
    Peer[Peer Workload]

    Workload -->|calls Workload API| Agent
    Agent -->|attestation evidence| Server
    Server -->|validates selectors| Attest
    Server -->|issues short-lived SVID| Agent
    Agent -->|delivers SVID| Workload
    Workload -->|mTLS/JWT-SVID| Peer
```

SPIFFE identity berbentuk URI:

```text
spiffe://trust-domain/path
```

Contoh:

```text
spiffe://agency.gov/ns/aceas-prod/sa/case-service
spiffe://agency.gov/ns/aceas-prod/sa/audit-service
spiffe://agency.gov/ns/aceas-prod/job/report-exporter
```

### 12.1 Kenapa SPIFFE Penting?

Tanpa SPIFFE, workload identity sering bergantung pada:

- static secret,
- mounted Kubernetes Secret,
- cloud-specific identity,
- manually rotated certificate,
- convention-based service name,
- network location.

SPIFFE memindahkan model ke:

- attested workload identity,
- short-lived credential,
- platform-neutral identity,
- X.509-SVID untuk mTLS,
- JWT-SVID untuk token-based auth,
- trust domain dan bundle federation.

### 12.2 SPIFFE Bukan Pengganti Authorization

SPIFFE memberi identity.

Authorization tetap harus menjawab:

```text
Bolehkah spiffe://agency.gov/ns/prod/sa/case-service
melakukan notification:send terhadap tenant CEA?
```

---

## 13. X.509-SVID vs JWT-SVID

| Aspek | X.509-SVID | JWT-SVID |
|---|---|---|
| Bentuk | X.509 certificate | JWT |
| Umum dipakai untuk | mTLS | bearer/proof token |
| Identity location | URI SAN | `sub` claim |
| Audience | channel peer / TLS validation | explicit `aud` |
| Revocation model | short-lived cert, bundle update | short-lived JWT, audience, issuer validation |
| Cocok untuk | direct service connection | non-TLS hop, HTTP metadata, token exchange |
| Risiko utama | cert validation salah | JWT validation/audience/replay salah |

### 13.1 Kapan X.509-SVID?

Gunakan X.509-SVID ketika:

- service berbicara langsung via HTTP/gRPC,
- mTLS feasible,
- ingin strong peer authentication,
- service mesh atau direct mTLS tersedia,
- latency rendah penting,
- identity ingin melekat ke connection.

### 13.2 Kapan JWT-SVID?

Gunakan JWT-SVID ketika:

- komunikasi lewat message broker,
- token perlu dibawa dalam HTTP header,
- workload perlu exchange token dengan external AS,
- target tidak bisa mTLS langsung,
- non-connection-oriented flow,
- async job/event processing.

### 13.3 Kesalahan Umum

1. JWT-SVID tanpa audience spesifik.
2. X.509-SVID diterima hanya karena chain valid, tanpa cek SPIFFE ID.
3. Trust domain dev dan prod memakai root yang sama tanpa policy boundary.
4. SVID dipakai sebagai “role”. Identity bukan permission.
5. SVID dicatat penuh di log.

---

## 14. Service Account, Workload, Instance, Pod, Job, dan Actor Chain

Service-to-service auth harus bisa menjelaskan actor chain.

Contoh synchronous call:

```mermaid
sequenceDiagram
    participant U as User Alice
    participant C as Case Service
    participant W as Workflow Service
    participant A as Audit Service

    U->>C: Approve case
    C->>W: Execute transition<br/>caller=case-service actor=Alice
    W->>A: Write audit<br/>caller=workflow-service actor=Alice upstream=case-service
```

Audit final harus dapat menjawab:

```text
Human actor: Alice
Entry service: case-service
Intermediate service: workflow-service
Final callee: audit-service
Tenant: CEA
Action: case.approve
Resource: CASE-123
Authority: user's case approval permission + workflow service grant
```

Contoh background job:

```text
scheduler -> report-export-worker -> document-service -> storage-service
```

Actor chain:

```text
job actor: report-export-job/2026-06-24
service caller: report-export-worker
purpose: scheduled monthly compliance export
tenant: CEA
approval: export policy v12
```

Tanpa actor chain, background operations terlihat seperti “system did it”, yang buruk untuk forensic dan regulatory defensibility.

---

## 15. Identity Propagation vs Delegation

### 15.1 Identity Propagation

Identity propagation membawa informasi actor/context downstream.

Contoh:

```http
X-Actor-Subject: user:123
X-Tenant-ID: cea
X-Correlation-ID: abc
```

Header seperti ini hanya aman jika:

- dibuat oleh trusted component,
- tidak diterima langsung dari public client,
- downstream memvalidasi caller,
- ada signature atau mTLS trust boundary,
- tidak dipakai sebagai authorization tanpa policy check.

### 15.2 Delegation

Delegation berarti service mendapat authority terbatas untuk bertindak atas nama subject tertentu.

Contoh:

```text
case-service receives user request.
case-service exchanges user token for downstream token.
downstream token audience = workflow-service.
scope = workflow.transition.execute.
actor = user:123.
client = case-service.
```

Delegation lebih kuat daripada raw header karena authority dibungkus dalam token/capability yang dapat divalidasi.

### 15.3 Impersonation

Impersonation berarti actor benar-benar tampil sebagai subject lain. Ini sangat berisiko dan harus dibatasi.

Gunakan impersonation hanya untuk:

- support tools,
- admin diagnostics,
- emergency operations,
- explicit approval flow.

Audit harus mencatat:

```text
admin_actor = support_user_17
impersonated_subject = user_123
reason = ticket INC-123
started_at
ended_at
approved_by
```

### 15.4 Rule of Thumb

| Need | Mekanisme |
|---|---|
| downstream tahu siapa user asli | identity propagation |
| downstream butuh authority terbatas | delegation token/capability |
| admin masuk sebagai user | controlled impersonation |
| service bertindak sebagai dirinya sendiri | client credentials/workload identity |

---

## 16. Authorization Antar-Service: Jangan Berhenti di Authentication

Setelah caller authenticated, callee harus melakukan authorization.

Contoh decision input:

```json
{
  "caller": {
    "kind": "workload",
    "id": "spiffe://agency.gov/ns/prod/sa/case-service",
    "auth_method": "x509-svid",
    "assurance": "workload_attested"
  },
  "actor": {
    "kind": "user",
    "id": "user:123",
    "tenant": "cea"
  },
  "action": "workflow.transition.execute",
  "resource": {
    "type": "case",
    "id": "CASE-123",
    "tenant": "cea",
    "stage": "pending_approval"
  },
  "environment": {
    "env": "prod",
    "time": "2026-06-24T10:30:00Z"
  }
}
```

Policy examples:

```text
case-service may call workflow.transition.execute only for tenant-bound cases
when actor has case.approve permission
and workflow stage allows transition
and service caller is production identity.
```

```text
notification-service may not read case details.
notification-service may only receive rendered notification payload.
```

```text
report-worker may generate export only for approved report jobs
and must not query arbitrary tenant data.
```

### 16.1 Coarse vs Fine-Grained Service Authorization

Coarse:

```text
case-service can call workflow-service
```

Fine-grained:

```text
case-service can call workflow-service.ExecuteTransition
only for tenant CEA
only with actor permission case.transition.execute
only for allowed transition set
```

Coarse authorization is useful at gateway/network layer. Fine-grained authorization belongs near business resource boundary.

---

## 17. Go Architecture: Package Boundary

Recommended package layout:

```text
/internal/authn
    peer.go
    credential.go
    token_verifier.go
    mtls.go
    spiffe.go

/internal/authz
    decision.go
    service_policy.go
    pdp.go

/internal/serviceidentity
    provider.go
    oauth_client.go
    spiffe_provider.go
    token_cache.go

/internal/transport/httpauth
    inbound_middleware.go
    outbound_roundtripper.go

/internal/transport/grpcauth
    unary_interceptor.go
    stream_interceptor.go
    credentials.go

/internal/audit
    auth_event.go
```

Design principle:

- `authn` identifies caller.
- `authz` decides whether caller may do action.
- `serviceidentity` obtains outbound credential.
- `transport` attaches/extracts credential.
- business service never parses raw JWT/cert directly.

Bad design:

```go
func Handle(w http.ResponseWriter, r *http.Request) {
    token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
    claims, _ := jwt.Parse(token)
    if claims["service"] == "case-service" {
        // do internal action
    }
}
```

Better design:

```go
func Handle(w http.ResponseWriter, r *http.Request) {
    peer := authn.PeerFromContext(r.Context())
    actor := authn.ActorFromContext(r.Context())

    decision, err := h.authorizer.Authorize(r.Context(), authz.Request{
        Caller: peer,
        Actor:  actor,
        Action: authz.Action("workflow.transition.execute"),
        Resource: authz.ResourceRef{
            Type:     "case",
            ID:       caseID,
            TenantID: tenantID,
        },
    })
    if err != nil || !decision.Allow {
        writeForbidden(w, decision)
        return
    }

    // business operation
}
```

---

## 18. Go Domain Types

### 18.1 Peer Identity

```go
package authn

import "time"

type PeerKind string

const (
	PeerKindWorkload PeerKind = "workload"
	PeerKindClient   PeerKind = "oauth_client"
	PeerKindGateway  PeerKind = "gateway"
	PeerKindUnknown  PeerKind = "unknown"
)

type AuthMethod string

const (
	AuthMethodMTLS             AuthMethod = "mtls"
	AuthMethodX509SVID         AuthMethod = "x509_svid"
	AuthMethodJWTSVID          AuthMethod = "jwt_svid"
	AuthMethodOAuthBearer      AuthMethod = "oauth_bearer"
	AuthMethodJWTClientAssert  AuthMethod = "jwt_client_assertion"
	AuthMethodClientSecret     AuthMethod = "client_secret"
)

type PeerIdentity struct {
	Kind        PeerKind
	ID          string // stable identity, e.g. SPIFFE ID or client_id
	DisplayName string
	TrustDomain string
	Environment string
	AuthMethod  AuthMethod
	Issuer      string
	Audience    []string
	Scopes      []string
	ExpiresAt   time.Time
	CredentialID string // kid, cert thumbprint, client key id, etc.
	RawSubject  string
}
```

### 18.2 Actor Chain

```go
type ActorKind string

const (
	ActorKindUser     ActorKind = "user"
	ActorKindWorkload ActorKind = "workload"
	ActorKindJob      ActorKind = "job"
	ActorKindSystem   ActorKind = "system"
)

type Actor struct {
	Kind     ActorKind
	ID       string
	TenantID string
	Source   string // session, delegated_token, job_context, propagated_header
}

type ActorChain struct {
	EntryActor      *Actor   // human or job at the system boundary
	DirectCaller    Actor    // immediate workload
	Intermediaries  []Actor  // optional upstream chain
	DelegationID    string
	ImpersonationID string
}
```

### 18.3 Authenticated Request Context

```go
type RequestAuthContext struct {
	Peer       PeerIdentity
	ActorChain ActorChain
	TenantID   string
	RequestID  string
	TraceID    string
	SourceIP   string
	ReceivedAt time.Time
}
```

Do not put raw untyped maps everywhere. Make auth context explicit and stable.

### 18.4 Service Authorizer

```go
package authz

import "context"

type Action string

type ResourceRef struct {
	Type     string
	ID       string
	TenantID string
	Attrs    map[string]string
}

type Request struct {
	Caller   authn.PeerIdentity
	Actor    authn.ActorChain
	Action   Action
	Resource ResourceRef
	Context  map[string]string
}

type Decision struct {
	Allow         bool
	ReasonCode    string
	PolicyID      string
	PolicyVersion string
	Obligations   []string
}

type Authorizer interface {
	Authorize(ctx context.Context, req Request) (Decision, error)
}
```

---

## 19. Pattern 1: Outbound OAuth2 Client Credentials di Go

Go package `golang.org/x/oauth2/clientcredentials` menyediakan implementasi Client Credentials flow.

Example:

```go
package serviceidentity

import (
	"context"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

type OAuthClientCredentialsConfig struct {
	ClientID     string
	ClientSecret string
	TokenURL     string
	Scopes       []string
	Audience     string
}

func NewClientCredentialsHTTPClient(ctx context.Context, cfg OAuthClientCredentialsConfig, base *http.Client) *http.Client {
	cc := clientcredentials.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		TokenURL:     cfg.TokenURL,
		Scopes:       cfg.Scopes,
		EndpointParams: map[string][]string{
			"audience": {cfg.Audience},
		},
		AuthStyle: oauth2.AuthStyleInHeader,
	}

	if base != nil {
		ctx = context.WithValue(ctx, oauth2.HTTPClient, base)
	}

	return cc.Client(ctx)
}

func ExampleCall(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return client.Do(req)
}

func DefaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}
```

### 19.1 What This Solves

- Token acquisition.
- Token refresh before expiry.
- Attaching bearer token to outbound request.

### 19.2 What This Does Not Solve

- secret storage,
- client secret rotation,
- token audience policy,
- resource server validation,
- authorization decision,
- audit,
- token replay resistance.

### 19.3 Production Notes

Do:

- use audience/resource indicators if supported,
- use least-privilege scopes,
- prefer private_key_jwt or mTLS client auth over static client secret for high assurance,
- set HTTP timeouts,
- isolate token cache per audience/scope/client,
- do not log tokens.

Do not:

- create one global `internal-service` client with all scopes,
- reuse same client secret across environments,
- store secrets in source code,
- accept any token signed by IdP without audience check.

---

## 20. Pattern 2: Inbound JWT Bearer Validation untuk Service API

Callee service must validate token before accepting request.

Validation pipeline:

```mermaid
flowchart TD
    Req[Inbound Request]
    Extract[Extract Bearer Token]
    Parse[Parse Header Safely]
    Key[Resolve Key from Trusted JWKS]
    Sig[Verify Signature]
    Claims[Validate iss aud exp nbf iat]
    TokenType[Validate token type/client claims]
    Scope[Check coarse scope]
    Peer[Build PeerIdentity]
    Authz[Authorize action/resource/tenant]
    Handler[Business Handler]

    Req --> Extract --> Parse --> Key --> Sig --> Claims --> TokenType --> Scope --> Peer --> Authz --> Handler
```

Example skeleton:

```go
type TokenVerifier interface {
	VerifyAccessToken(ctx context.Context, raw string, expectedAudience string) (authn.PeerIdentity, error)
}

type BearerMiddleware struct {
	Verifier TokenVerifier
	Audience string
}

func (m BearerMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			writeAuthError(w, http.StatusUnauthorized, "missing_bearer_token")
			return
		}

		peer, err := m.Verifier.VerifyAccessToken(r.Context(), raw, m.Audience)
		if err != nil {
			writeAuthError(w, http.StatusUnauthorized, "invalid_bearer_token")
			return
		}

		ctx := authn.ContextWithPeer(r.Context(), peer)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearerToken(h string) (string, bool) {
	const prefix = "Bearer "
	if len(h) <= len(prefix) || h[:len(prefix)] != prefix {
		return "", false
	}
	return h[len(prefix):], true
}
```

The actual JWT verification should reuse the robust validator design from Part 010.

Important: token validation and authorization are different steps.

---

## 21. Pattern 3: Basic mTLS Server dan Client di Go

This is a conceptual baseline. In production, certificate issuance/rotation should be automated.

### 21.1 mTLS Server

```go
package mtls

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
)

func NewServer(certFile, keyFile, clientCAFile string, handler http.Handler) (*http.Server, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load server keypair: %w", err)
	}

	caPEM, err := os.ReadFile(clientCAFile)
	if err != nil {
		return nil, fmt.Errorf("read client ca: %w", err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("invalid client ca pem")
	}

	tlsConfig := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{cert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}

	return &http.Server{
		Addr:      ":8443",
		Handler:   handler,
		TLSConfig: tlsConfig,
	}, nil
}
```

### 21.2 Extract Peer Certificate Identity

```go
func PeerCertificate(r *http.Request) (*x509.Certificate, bool) {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		return nil, false
	}
	return r.TLS.PeerCertificates[0], true
}

func URISANs(cert *x509.Certificate) []string {
	out := make([]string, 0, len(cert.URIs))
	for _, u := range cert.URIs {
		out = append(out, u.String())
	}
	return out
}
```

### 21.3 mTLS Client

```go
func NewClient(certFile, keyFile, serverCAFile string) (*http.Client, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load client keypair: %w", err)
	}

	caPEM, err := os.ReadFile(serverCAFile)
	if err != nil {
		return nil, fmt.Errorf("read server ca: %w", err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("invalid server ca pem")
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion:   tls.VersionTLS12,
			Certificates: []tls.Certificate{cert},
			RootCAs:      pool,
		},
	}

	return &http.Client{Transport: tr}, nil
}
```

### 21.4 Production Gap

This example does not solve:

- cert issuance,
- cert rotation,
- cert revocation,
- identity mapping,
- SAN policy,
- trust domain federation,
- service authorization.

That is why SPIFFE/SPIRE or a managed workload identity platform is often preferred.

---

## 22. Pattern 4: SPIFFE mTLS dengan go-spiffe

The `go-spiffe` library provides high-level functionality for SPIFFE identities, including X.509-SVID and JWT-SVID handling.

Illustrative server:

```go
package spiffehttp

import (
	"context"
	"net/http"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

func NewServer(ctx context.Context, addr string, allowedClient string, handler http.Handler) (*http.Server, error) {
	source, err := workloadapi.NewX509Source(ctx)
	if err != nil {
		return nil, err
	}

	clientID := spiffeid.RequireFromString(allowedClient)

	tlsConfig := tlsconfig.MTLSServerConfig(
		source,
		source,
		tlsconfig.AuthorizeID(clientID),
	)

	return &http.Server{
		Addr:      addr,
		Handler:   handler,
		TLSConfig: tlsConfig,
	}, nil
}
```

Illustrative client:

```go
func NewClient(ctx context.Context, allowedServer string) (*http.Client, error) {
	source, err := workloadapi.NewX509Source(ctx)
	if err != nil {
		return nil, err
	}

	serverID := spiffeid.RequireFromString(allowedServer)

	tr := &http.Transport{
		TLSClientConfig: tlsconfig.MTLSClientConfig(
			source,
			source,
			tlsconfig.AuthorizeID(serverID),
		),
	}

	return &http.Client{Transport: tr}, nil
}
```

### 22.1 Important Design Notes

- `AuthorizeID` is strict but static; real systems often need policy-based allowed peer identity.
- Workload API source handles credential rotation.
- SPIFFE ID should be mapped to service identity and environment.
- mTLS identity should be fed into authorization context.
- Direct mTLS does not automatically propagate human actor.

### 22.2 SPIFFE Identity Mapping

Example mapping:

```go
func MapSPIFFEID(id string) (authn.PeerIdentity, error) {
	parsed, err := spiffeid.FromString(id)
	if err != nil {
		return authn.PeerIdentity{}, err
	}

	// Example path convention:
	// /ns/{namespace}/sa/{service-account}
	return authn.PeerIdentity{
		Kind:        authn.PeerKindWorkload,
		ID:          parsed.String(),
		TrustDomain: parsed.TrustDomain().String(),
		AuthMethod:  authn.AuthMethodX509SVID,
	}, nil
}
```

Do not overfit identity semantics into path parsing without governance. Define a formal SPIFFE ID naming contract.

---

## 23. Pattern 5: JWT-SVID untuk HTTP/gRPC Bearer Credential

JWT-SVID can be used when direct mTLS is not feasible.

Conceptual flow:

```mermaid
sequenceDiagram
    participant W as Workload
    participant API as SPIFFE Workload API
    participant B as Downstream Service

    W->>API: Fetch JWT-SVID for audience B
    API-->>W: JWT-SVID sub=spiffe://... aud=B exp=short
    W->>B: Authorization: Bearer JWT-SVID
    B->>B: validate issuer, bundle, signature, aud, exp, SPIFFE ID
    B->>B: authorize SPIFFE ID for action/resource
    B-->>W: response
```

Pseudo-code shape:

```go
type JWTSVIDSource interface {
	FetchJWTSVID(ctx context.Context, audience string) (token string, expiresAt time.Time, err error)
}

type SVIDRoundTripper struct {
	Base     http.RoundTripper
	Source   JWTSVIDSource
	Audience string
}

func (rt SVIDRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	base := rt.Base
	if base == nil {
		base = http.DefaultTransport
	}

	token, _, err := rt.Source.FetchJWTSVID(req.Context(), rt.Audience)
	if err != nil {
		return nil, err
	}

	clone := req.Clone(req.Context())
	clone.Header = clone.Header.Clone()
	clone.Header.Set("Authorization", "Bearer "+token)
	return base.RoundTrip(clone)
}
```

JWT-SVID validation must check:

- trust domain,
- issuer/bundle,
- signature,
- subject SPIFFE ID,
- audience,
- expiry,
- allowed caller policy.

---

## 24. Pattern 6: Gateway-to-Service Identity Forwarding

A common architecture:

```mermaid
flowchart LR
    Client[External Client]
    Gateway[API Gateway]
    Service[Internal Service]

    Client -->|public token/session| Gateway
    Gateway -->|mTLS + signed context/token| Service
```

The gateway may authenticate external users and forward context downstream.

Dangerous design:

```http
X-User-ID: user-123
X-Tenant-ID: cea
X-Roles: admin
```

Safer design options:

1. Gateway uses mTLS to authenticate itself to downstream service.
2. Gateway strips all inbound identity headers before adding its own.
3. Gateway sends signed internal context token with audience bound to callee.
4. Downstream validates gateway identity and internal token.
5. Downstream still performs authorization.

Example internal context token claims:

```json
{
  "iss": "https://gateway.prod.example.gov",
  "aud": "case-service",
  "sub": "user:123",
  "tenant": "cea",
  "entry_client": "public-web",
  "auth_time": 1782300000,
  "amr": ["pwd", "otp"],
  "acr": "aal2",
  "scope": "case:read case:update",
  "jti": "context-token-id",
  "exp": 1782300300
}
```

Downstream must not accept the same token for another audience.

---

## 25. Pattern 7: Worker/Job Identity

Workers are often privileged and under-modeled.

Examples:

- scheduled report export,
- notification retry worker,
- case escalation batch,
- document virus scan worker,
- data archival job,
- webhook delivery worker,
- reconciliation job.

Worker identity should include:

```text
workload identity: report-export-worker
job identity: monthly-compliance-export-2026-06
trigger: scheduler
approval/policy: report-policy-v7
tenant: CEA
run id: job-run-123
```

### 25.1 Worker Auth Context

```go
type JobContext struct {
	JobID        string
	RunID        string
	JobType      string
	TenantID     string
	TriggeredBy  string // scheduler, user, event, admin
	ApprovedBy   string
	PolicyID     string
	Purpose      string
	StartedAt    time.Time
}
```

### 25.2 Worker Authorization Rule

A worker should not have blanket DB/service access just because it is internal.

Example policy:

```text
report-export-worker may call document-service.read
only for documents included in approved report job scope
and only for tenant in job context
and only during active job run window.
```

### 25.3 Worker Failure Modes

| Failure | Result |
|---|---|
| worker token has global tenant access | cross-tenant export |
| job context not signed | forged tenant/job scope |
| retry worker reuses stale capability | action after revocation |
| queue message lacks actor chain | audit gap |
| worker service account shared by all jobs | blast radius too large |

---

## 26. Pattern 8: Event-Driven Service Identity

In async systems, there may be no direct TLS caller at processing time.

Example:

```mermaid
sequenceDiagram
    participant C as Case Service
    participant Q as Message Broker
    participant W as Notification Worker
    participant N as Notification API

    C->>Q: publish CaseApproved event + signed envelope
    W->>Q: consume event
    W->>W: validate event producer + envelope
    W->>N: send notification with worker credential + event actor context
```

Event envelope should include:

```json
{
  "event_id": "evt-123",
  "event_type": "case.approved",
  "producer": "spiffe://agency.gov/ns/prod/sa/case-service",
  "tenant": "cea",
  "resource": "case:CASE-123",
  "actor": "user:123",
  "occurred_at": "2026-06-24T10:30:00Z",
  "signature": "..."
}
```

Consumer must validate:

- broker authentication,
- producer identity,
- event signature or trusted envelope,
- event freshness/idempotency,
- tenant/resource scope,
- consumer permission to process event,
- downstream permission to act.

Broker ACL alone is not enough.

---

## 27. gRPC Service-to-Service Auth Preview

gRPC has two common auth layers:

1. Transport credentials: TLS/mTLS.
2. Per-RPC credentials: metadata token.

Conceptual inbound unary interceptor:

```go
type UnaryAuthInterceptor struct {
	Authenticator Authenticator
	Authorizer    authz.Authorizer
}

func (i UnaryAuthInterceptor) Intercept(
	ctx context.Context,
	req any,
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (any, error) {
	peer, err := i.Authenticator.AuthenticateGRPC(ctx)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "unauthenticated")
	}

	ctx = authn.ContextWithPeer(ctx, peer)

	decision, err := i.Authorizer.Authorize(ctx, authz.Request{
		Caller: peer,
		Action: authz.Action(info.FullMethod),
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "authorization_error")
	}
	if !decision.Allow {
		return nil, status.Error(codes.PermissionDenied, "permission_denied")
	}

	return handler(ctx, req)
}
```

A later part covers gRPC auth deeply. For now, remember:

- mTLS peer identity and metadata token identity must not conflict silently.
- per-method authorization is required.
- streaming RPC needs auth context for entire stream and sometimes per-message checks.
- propagated actor context must be validated.

---

## 28. Multi-Tenant Service-to-Service Auth

Tenant context must not be a free-form parameter.

Bad:

```http
POST /internal/export?tenant=cea
Authorization: Bearer service-token-with-global-access
```

Better:

```json
{
  "caller": "report-service-prod",
  "tenant": "cea",
  "aud": "export-service",
  "scope": "export:create",
  "job_id": "approved-export-job-123",
  "exp": 1782300300
}
```

And callee checks:

- caller can act for tenant,
- job is approved for tenant,
- resource belongs to tenant,
- token audience is callee,
- action is allowed,
- data query is tenant-guarded.

### 28.1 Tenant-Bound Service Identity

Sometimes identity itself includes tenant:

```text
spiffe://agency.gov/tenant/cea/ns/prod/sa/report-service
```

This is useful if the deployment is tenant-specific.

But in shared service deployment, tenant should usually be request context, not service identity:

```text
spiffe://agency.gov/ns/prod/sa/report-service
request tenant = cea
```

Policy decides which tenants the service may access.

### 28.2 Cross-Tenant Admin Service

Cross-tenant services require special controls:

- explicit cross-tenant role/grant,
- reason code,
- approval,
- audit,
- field-level redaction,
- stronger monitoring,
- separate service account if possible.

---

## 29. Secret Management dan Credential Rotation

### 29.1 Static Client Secret

Static client secrets are operationally simple but dangerous.

Rules:

- never embed in code/image,
- store in secret manager,
- rotate periodically and on suspicion,
- support dual secret overlap,
- scope per client/environment/audience,
- avoid sharing across services,
- monitor usage anomaly.

### 29.2 Private Key Client Assertion

Better than shared secret if:

- private key is protected,
- key id is managed,
- AS holds public key/JWKS,
- assertions are short-lived,
- `jti` replay detection exists,
- rotation supports multiple active keys.

### 29.3 X.509 Certificate

Need lifecycle:

- issuance,
- renewal,
- trust bundle update,
- expiry monitoring,
- revocation strategy,
- identity mapping,
- emergency root/intermediate rotation.

### 29.4 SPIFFE SVID

SVID improves lifecycle because it is short-lived and issued via Workload API, but platform operation must be healthy:

- SPIRE server availability,
- agent health,
- attestation policy correctness,
- bundle distribution,
- trust domain governance,
- workload selector specificity.

---

## 30. Caching, Expiry, Revocation, dan Staleness

Service-to-service auth relies heavily on caches:

- token cache,
- JWKS cache,
- certificate bundle cache,
- introspection cache,
- policy decision cache,
- service permission cache,
- tenant grant cache.

Every cache needs a staleness budget.

### 30.1 Token Cache

Outbound service may cache access token until near expiry.

Good practice:

```text
refresh_at = exp - jitter - safety_window
```

Avoid thundering herd:

- singleflight per client/audience/scope,
- jitter,
- background refresh,
- graceful fallback for still-valid token.

### 30.2 JWKS/Bundle Cache

Resource server must cache keys but respond to rotation.

Rules:

- respect cache headers where appropriate,
- refresh on unknown `kid` with rate limit,
- never trust `jku` from arbitrary token,
- pin issuer to configured JWKS URI,
- support emergency key denylist if needed.

### 30.3 Revocation

Short-lived tokens reduce revocation dependence. But high-risk environments still need:

- client disable,
- service account revoke,
- token family revoke,
- mTLS cert revoke or trust removal,
- SPIFFE registration removal,
- policy deny override,
- emergency blocklist.

### 30.4 Staleness Policy

Example:

| Data | Max Staleness |
|---|---:|
| access token | until expiry, usually minutes |
| JWKS | minutes/hours depending key rotation plan |
| service permission | seconds/minutes for high-risk APIs |
| tenant grant | low staleness for tenant boundary |
| break-glass denylist | near-real-time |

---

## 31. Auditability: Siapa Memanggil Siapa, Sebagai Apa, Untuk Apa

Audit event for service-to-service request:

```json
{
  "event_type": "service_authorization_decision",
  "decision": "allow",
  "reason_code": "policy_allow_service_action",
  "request_id": "req-123",
  "trace_id": "trace-abc",
  "caller": {
    "id": "spiffe://agency.gov/ns/prod/sa/case-service",
    "auth_method": "x509_svid",
    "trust_domain": "agency.gov"
  },
  "actor_chain": {
    "entry_actor": "user:123",
    "direct_caller": "case-service",
    "delegation_id": "del-456"
  },
  "tenant": "cea",
  "action": "workflow.transition.execute",
  "resource": "case:CASE-123",
  "policy": {
    "id": "svc-workflow-policy",
    "version": "2026-06-24.1"
  },
  "credential": {
    "issuer": "spire-prod",
    "credential_id": "cert-thumbprint-or-kid",
    "expires_at": "2026-06-24T10:35:00Z"
  },
  "time": "2026-06-24T10:30:01Z"
}
```

Do not log:

- raw bearer tokens,
- private keys,
- full certificates unless explicitly safe and needed,
- secrets,
- sensitive claims not needed for audit.

---

## 32. Observability yang Aman

Metrics:

```text
authn_success_total{method,service,issuer}
authn_failure_total{method,reason}
authz_decision_total{action,decision,reason}
token_acquisition_total{client,audience,result}
token_acquisition_latency_seconds
mtls_handshake_failure_total{reason}
spiffe_svid_refresh_total{result}
jwks_refresh_total{issuer,result}
credential_expiry_seconds{service,credential_type}
```

Logs should include:

- request ID,
- trace ID,
- peer identity,
- credential type,
- issuer,
- audience,
- decision reason,
- policy version.

Logs should not include:

- raw token,
- secret,
- private key,
- full user PII,
- uncontrolled claims map.

Trace attributes:

```text
auth.peer.id
auth.peer.method
auth.issuer
auth.audience
authz.action
authz.decision
authz.policy.version
tenant.id
```

Be careful: high-cardinality labels like resource ID should usually not be metric labels.

---

## 33. Testing Strategy

### 33.1 Unit Tests

Test:

- token extraction,
- missing/invalid Authorization header,
- issuer mismatch,
- audience mismatch,
- expired token,
- future `nbf`,
- wrong algorithm,
- unknown `kid`,
- invalid certificate SAN,
- disallowed SPIFFE ID,
- authorization deny,
- tenant mismatch,
- actor chain conflict.

### 33.2 Integration Tests

Use local fake AS/SPIRE-like fixture:

- issue test JWT,
- expose JWKS,
- rotate keys,
- simulate unknown `kid`,
- simulate token endpoint outage,
- simulate expired cert,
- simulate mTLS peer.

### 33.3 Policy Tests

Policy test cases should read like business invariants:

```text
case-service may execute workflow transition for same tenant.
case-service may not execute transition for another tenant.
notification-service may send email but may not read case document.
report-worker may export only approved job scope.
dev identity is rejected by prod service.
```

### 33.4 Chaos / Failure Tests

Simulate:

- token endpoint latency,
- JWKS endpoint outage,
- key rotation,
- SPIRE agent restart,
- certificate expiry,
- bundle stale,
- clock skew,
- policy store unavailable,
- cache stampede.

---

## 34. Performance Engineering

Service-to-service auth can become a latency bottleneck if poorly designed.

### 34.1 Common Hot Paths

- token verification per request,
- JWKS lookup,
- policy decision,
- PIP attribute fetch,
- mTLS handshake,
- token acquisition,
- introspection.

### 34.2 Optimization Principles

1. Verify JWT locally when possible.
2. Cache JWKS/bundles safely.
3. Use connection pooling to amortize TLS handshakes.
4. Use short-lived token but cache outbound token until safe refresh window.
5. Avoid remote PDP call for ultra-hot low-risk endpoint unless needed.
6. Use singleflight for token refresh and JWKS refresh.
7. Separate authentication cache from authorization decision cache.
8. Never skip validation for performance without explicit risk acceptance.

### 34.3 Handshake vs Request Validation

mTLS handshake happens per connection, not per request, with HTTP keep-alive or HTTP/2.

JWT validation happens per request unless cached by token ID/hash. Be careful caching bearer token validation because revocation and tenant/action context may differ.

### 34.4 Introspection Cost

Opaque token introspection can add remote call per request. Mitigate with:

- short cache TTL,
- token hash cache,
- introspection result staleness policy,
- circuit breaker,
- degrade mode only for low-risk endpoints if approved.

---

## 35. Failure Modes Matrix

| Failure Mode | Root Cause | Impact | Mitigation |
|---|---|---|---|
| Internal header spoofing | service trusts `X-Service-Name` | impersonation | strip headers, mTLS, signed context token |
| Token audience not checked | validator incomplete | token substitution | strict audience per service |
| Shared service account | many workloads same credential | large blast radius | per-service identity |
| Static secret leaked | env/log/CI leak | service impersonation | short-lived credential, rotation, secret manager |
| mTLS chain valid but SAN ignored | incomplete cert validation | wrong client accepted | verify URI/DNS SAN/SPIFFE ID |
| Dev identity accepted in prod | shared trust root/policy | environment breakout | trust domain/env claim separation |
| No service-level auth | authn-only design | lateral movement | PDP/PEP per action/resource |
| Stale policy cache | revocation delay | unauthorized access continues | staleness budget, invalidation, deny override |
| JWKS cache stale | rotation mishandled | outage or bad token accepted | refresh strategy, fallback, emergency revoke |
| Token endpoint outage | AS unavailable | cascading failure | cache valid tokens, retry/backoff, runbook |
| SPIRE agent down | SVID unavailable | auth failure | readiness, renewal buffer, HA control plane |
| Clock skew | bad node time | token/cert rejected | NTP monitoring, skew tolerance |
| Overbroad client scope | poor grant model | privilege escalation | least privilege, scope review |
| Missing actor chain | poor propagation | audit gap | actor/delegation context contract |
| Async message lacks producer proof | broker trust only | forged event | signed envelope, producer identity |
| Worker global access | shared job account | cross-tenant data access | job-scoped capability |
| mTLS only at mesh | app ignores identity | policy blind spot | expose peer identity to app authz |

---

## 36. Anti-Pattern yang Harus Dihindari

### 36.1 “It is internal, so no auth needed”

This is the root of many lateral movement failures.

### 36.2 One Token to Rule Them All

A single internal token with all scopes is equivalent to a master key.

### 36.3 Service Name Header Auth

```http
X-Service: admin-service
```

This is not authentication.

### 36.4 TLS Without Identity Authorization

Encrypting traffic is not enough. You must know and authorize the peer.

### 36.5 JWT Decode Without Validation

Parsing claims is not validation.

### 36.6 Gateway-Only Authorization

Gateway checks are useful but insufficient for object-level, tenant-level, and workflow-level authorization.

### 36.7 Long-Lived Client Secrets in Config Files

This leads to operational debt and leak impact.

### 36.8 Shared Kubernetes Service Account

Multiple workloads sharing one service account destroys accountability and least privilege.

### 36.9 No Emergency Revocation Path

If a service credential is leaked, you need to answer immediately:

- how to disable it,
- which services trust it,
- which tokens remain valid,
- which policies allow it,
- what activity it performed.

### 36.10 Confusing Caller Service with Human Actor

Both matter. Neither replaces the other.

---

## 37. Reference Architecture

```mermaid
flowchart TD
    subgraph IdentityControlPlane[Identity Control Plane]
        AS[OAuth Authorization Server]
        JWKS[JWKS Endpoint]
        SPIRE[SPIRE Server]
        Policy[Policy Admin / PAP]
        PDP[PDP / Policy Engine]
    end

    subgraph Runtime[Runtime Platform]
        Agent[SPIRE Agent / Workload API]
        Case[case-service]
        Workflow[workflow-service]
        Audit[audit-service]
        Worker[report-worker]
    end

    subgraph DataPlane[Data Plane]
        Broker[Message Broker]
        DB[(Database)]
        ObjectStore[(Object Store)]
    end

    SPIRE --> Agent
    Agent -->|X.509-SVID/JWT-SVID| Case
    Agent -->|X.509-SVID/JWT-SVID| Workflow
    Agent -->|X.509-SVID/JWT-SVID| Audit
    Agent -->|X.509-SVID/JWT-SVID| Worker

    AS --> JWKS
    Case -->|mTLS / token| Workflow
    Workflow -->|mTLS / token| Audit
    Worker -->|token / mTLS| Audit
    Case -->|signed event| Broker
    Broker --> Worker

    Case --> PDP
    Workflow --> PDP
    Audit --> PDP
    Worker --> PDP

    Policy --> PDP
    Audit --> DB
    Worker --> ObjectStore
```

Key decisions:

- SPIFFE/SPIRE issues workload identity.
- OAuth AS issues access tokens when OAuth semantics are needed.
- mTLS used for direct service communication.
- JWT-SVID or OAuth token used for non-direct/asynchronous paths.
- PDP handles service authorization decisions.
- Audit service records caller + actor chain + policy version.

---

## 38. Case Study: Regulatory Case Management Platform

### 38.1 Services

```text
case-service
workflow-service
document-service
notification-service
audit-service
report-export-worker
screening-engine
external-connector
```

### 38.2 Bad Initial Design

```text
All internal services share INTERNAL_API_KEY.
Gateway injects X-User-ID and X-Tenant-ID.
Services trust internal headers.
Report worker has read access to all tenants.
Audit only records user ID.
```

Failure scenario:

1. Notification service compromised.
2. Attacker reads `INTERNAL_API_KEY` from environment.
3. Attacker calls document-service internal endpoint.
4. Attacker passes `X-Tenant-ID: other_agency`.
5. Document-service returns documents because it trusts internal key and tenant parameter.
6. Audit logs only “system access”.

### 38.3 Improved Design

Service identities:

```text
spiffe://regulator.gov/ns/prod/sa/case-service
spiffe://regulator.gov/ns/prod/sa/workflow-service
spiffe://regulator.gov/ns/prod/sa/document-service
spiffe://regulator.gov/ns/prod/sa/notification-service
spiffe://regulator.gov/ns/prod/sa/audit-service
spiffe://regulator.gov/ns/prod/job/report-export-worker
```

Policy:

```text
case-service may call workflow-service transition APIs.
workflow-service may write audit events.
notification-service may send rendered notifications only.
notification-service may not read case documents.
report-export-worker may read documents only for approved export job tenant scope.
external-connector may call address validation only, not case mutation.
```

Token/cert strategy:

- mTLS with X.509-SVID for direct gRPC/HTTP service calls.
- JWT-SVID or job-scoped OAuth token for async worker processing.
- Signed event envelope for broker messages.
- Tenant-bound capability for report export job.
- Audit captures direct caller, human actor, job ID, tenant, resource, decision.

### 38.4 Authorization Decision Example

Request:

```text
report-export-worker -> document-service.ReadDocument
resource = document:DOC-99
tenant = CEA
job_id = monthly-export-2026-06
```

Decision logic:

```text
Allow if:
- caller identity == report-export-worker prod identity
- job_id exists and status == APPROVED
- job tenant == CEA
- document tenant == CEA
- document included in export scope
- export window is active
- policy version allows document export
```

Denied if:

- document belongs to another tenant,
- job expired,
- caller is notification-service,
- identity is dev/staging,
- actor chain missing for user-triggered export,
- emergency export freeze is active.

---

## 39. Checklist Production Readiness

### Identity

- [ ] Every service/workload has unique identity.
- [ ] Identity is environment-bound.
- [ ] Identity has owner/team.
- [ ] Identity has documented purpose.
- [ ] No shared internal master credential.
- [ ] Workload identity issuance is automated.

### Credential

- [ ] Credential is short-lived where possible.
- [ ] Static secrets are minimized.
- [ ] Secret storage uses approved secret manager.
- [ ] Rotation supports overlap.
- [ ] Emergency revocation exists.
- [ ] Credential expiry is monitored.

### Token

- [ ] Issuer validated.
- [ ] Audience validated.
- [ ] Expiry/nbf/iat validated.
- [ ] Algorithm allowlisted.
- [ ] JWKS source pinned to issuer config.
- [ ] Token type checked.
- [ ] Scope not treated as full authorization.

### mTLS

- [ ] Client cert required where expected.
- [ ] Client chain validated.
- [ ] SAN/URI/SPIFFE ID validated.
- [ ] Trust domain separated by environment.
- [ ] Cert rotation tested.
- [ ] Peer identity mapped to auth context.

### SPIFFE/SPIRE

- [ ] SPIFFE ID naming convention documented.
- [ ] Workload selectors are specific.
- [ ] Agent/server HA considered.
- [ ] Bundle rotation tested.
- [ ] SVID expiry monitored.
- [ ] Trust domain federation governed.

### Authorization

- [ ] Authenticated service still goes through authorization.
- [ ] Caller/action/resource/tenant modeled.
- [ ] Deny-by-default.
- [ ] Internal endpoints not exempt by default.
- [ ] Policy version logged.
- [ ] Cross-tenant access explicitly controlled.

### Propagation/Delegation

- [ ] Actor chain modeled.
- [ ] Raw identity headers stripped at boundary.
- [ ] Gateway-forwarded identity is protected.
- [ ] Delegation tokens are audience/scope/time-bound.
- [ ] Impersonation is separately audited.

### Audit/Observability

- [ ] Authn success/failure metrics.
- [ ] Authz decision metrics.
- [ ] Credential expiry alerts.
- [ ] Token endpoint error alerts.
- [ ] mTLS handshake failure alerts.
- [ ] Raw tokens/secrets never logged.

### Testing

- [ ] Audience mismatch test.
- [ ] Env mismatch test.
- [ ] Tenant mismatch test.
- [ ] Cert SAN mismatch test.
- [ ] Unknown key test.
- [ ] Expired credential test.
- [ ] Stale policy test.
- [ ] Token endpoint outage test.

---

## 40. Pertanyaan Review

1. Apa perbedaan service identity, workload identity, workload instance identity, dan service account?
2. Mengapa mTLS tidak otomatis menyelesaikan authorization?
3. Apa perbedaan Client Credentials dan JWT Bearer Grant?
4. Apa perbedaan JWT client assertion dan access token?
5. Kenapa audience binding penting dalam service-to-service token?
6. Bagaimana certificate-bound access token mencegah replay token curian?
7. Apa perbedaan X.509-SVID dan JWT-SVID?
8. Mengapa raw `X-User-ID` header tidak boleh dipercaya downstream?
9. Bagaimana cara mendesain actor chain untuk request user yang melewati beberapa service?
10. Apa failure mode dari shared service account?
11. Bagaimana service authorization berbeda dari network policy?
12. Apa yang harus diaudit dalam service-to-service authorization decision?
13. Bagaimana worker/job identity harus dimodelkan?
14. Bagaimana event-driven system membuktikan producer identity?
15. Apa emergency revocation path untuk compromised workload credential?

---

## 41. Ringkasan

Service-to-service auth adalah salah satu area yang membedakan sistem biasa dari sistem enterprise-grade.

Kesimpulan utama:

1. **Internal traffic tetap harus diautentikasi dan diautorisasi.**
2. **Workload identity berbeda dari human identity.**
3. **Service account harus punya lifecycle, owner, purpose, rotation, dan revocation path.**
4. **Client Credentials cocok untuk service acting as itself, tetapi bukan pengganti fine-grained authorization.**
5. **JWT client assertion mengurangi shared secret risk, tetapi membutuhkan key lifecycle dan replay control.**
6. **mTLS membuktikan peer pada channel, tetapi tidak otomatis membuktikan user/delegation/business permission.**
7. **Certificate-bound token mengurangi bearer token replay risk.**
8. **SPIFFE/SPIRE memberi model workload identity yang short-lived, attested, dan platform-neutral.**
9. **X.509-SVID cocok untuk direct mTLS; JWT-SVID cocok untuk token/non-direct path.**
10. **Actor chain penting untuk audit dan regulatory defensibility.**
11. **Gateway identity forwarding harus protected; raw headers tidak cukup.**
12. **Worker, job, dan event consumer juga perlu identity dan authorization.**
13. **Service-to-service authorization harus mempertimbangkan caller, actor, action, resource, tenant, purpose, dan policy version.**

Mental model yang harus dibawa ke part berikutnya:

> Service-to-service auth bukan tentang “service punya token”. Ia adalah sistem supply chain identity: dari attestation, credential issuance, transport proof, token validation, caller/actor modelling, policy decision, tenant guard, sampai audit forensic.

---

## 42. Referensi Primer

- Go 1.26 Release Notes — https://go.dev/doc/go1.26
- Go `crypto/tls` package — https://pkg.go.dev/crypto/tls
- Go `golang.org/x/oauth2/clientcredentials` — https://pkg.go.dev/golang.org/x/oauth2/clientcredentials
- RFC 6749 — OAuth 2.0 Authorization Framework — https://datatracker.ietf.org/doc/html/rfc6749
- RFC 7523 — JWT Profile for OAuth 2.0 Client Authentication and Authorization Grants — https://datatracker.ietf.org/doc/html/rfc7523
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens — https://www.rfc-editor.org/rfc/rfc8705.html
- RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens — https://www.rfc-editor.org/info/rfc9068
- RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession — https://www.rfc-editor.org/info/rfc9449
- SPIFFE Concepts — https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/
- SPIFFE Workload API — https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/
- SPIRE Concepts — https://spiffe.io/docs/latest/spire-about/spire-concepts/
- go-spiffe v2 — https://pkg.go.dev/github.com/spiffe/go-spiffe/v2
- OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP API Security Top 10 — https://owasp.org/API-Security/editions/2023/en/0x11-t10/

---

## Status Seri

Seri **belum selesai**.

Lanjut berikutnya:

`learn-go-authentication-authorization-identity-permission-part-028.md` — **gRPC Auth: Metadata, Interceptor Chain, Per-RPC Authorization**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-authentication-authorization-identity-permission-part-026.md">⬅️ Part 026 — Multi-Tenant Authorization: Tenant Boundary, Org Tree, Cross-Tenant Risk</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-authentication-authorization-identity-permission-part-028.md">Part 028 — gRPC Auth: Metadata, Interceptor Chain, Per-RPC Authorization ➡️</a>
</div>
